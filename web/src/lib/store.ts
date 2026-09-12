import { create } from "zustand";
import type { Car } from "@/types/Car";
import type { CircuitCatalogueEntry } from "@/types/CircuitCatalogueEntry";
import type { ClientRole } from "@/types/ClientRole";
import type { DiagnosticAlert } from "@/types/DiagnosticAlert";
import type { DomainEvent } from "@/types/DomainEvent";
import type { Panel } from "@/types/Panel";
import type { ScenarioCatalogueEntry } from "@/types/ScenarioCatalogueEntry";
import type { ScenarioFinishReason } from "@/types/ScenarioFinishReason";
import type { ServerMessage } from "@/types/ServerMessage";
import type { MarshalPresenceEntry } from "@/types/MarshalPresenceEntry";
import type { CarNumber, PanelId, ZoneId } from "@/types/ids";
import type { FlagState } from "@/types/FlagState";
import type { CircuitTopology } from "./topology";
import { type ConnectionStatus, WsClient, buildDefaultUrl } from "./ws";
import { safeRandomUUID, safeStorageGet, safeStorageSet } from "./uuid";

interface ScenarioProgress {
  step_idx: number;
  total_steps: number;
  mark: string | null;
  kind: string;
  at: string;
}

interface ScenarioRun {
  name: string;
  description: string | null;
  total_steps: number;
  progress: ScenarioProgress[];
  marks: { step_idx: number; label: string }[];
  status: "running" | "finished" | "stopped" | "failed";
  result?: {
    reason: ScenarioFinishReason;
    assertions_passed: number;
    assertions_failed: number;
  };
}

interface EcuLight {
  zone: ZoneId;
  flag: FlagState;
  at: string;
}

interface DiagnosticEntry {
  alert: DiagnosticAlert;
  at: string;
}

interface EventLogEntry {
  id: string;
  event: DomainEvent;
  at: string;
}

interface AppState {
  topology: CircuitTopology | null;
  panels: Record<number, Panel>;
  cars: Record<number, Car>;
  role: ClientRole;
  status: ConnectionStatus;
  events: EventLogEntry[];
  alerts: DiagnosticEntry[];
  activeAlerts: Record<number, DiagnosticAlert[]>;
  ecuLights: Record<number, EcuLight>;
  client: WsClient | null;

  mode: "track" | "demo";
  authRequired: boolean;
  authenticated: boolean;
  authRole: "race_control" | "marshal" | null;
  userName: string | null;
  marshalPost: number | null;
  marshalRoster: MarshalPresenceEntry[];

  scenarios: ScenarioCatalogueEntry[];
  scenarioRun: ScenarioRun | null;

  circuits: CircuitCatalogueEntry[];
  activeCircuitId: string | null;

  init(): Promise<void>;
  setRole(role: ClientRole): void;
  returnToRaceControl(): void;
  login(params: {
    role: "race_control" | "marshal";
    name?: string;
    post?: number;
    pin?: string;
    password?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  logout(): void;
  checkInMarshal(): void;
  resetSession(): void;
  handleMessage(msg: ServerMessage): void;
  startScenario(name: string, speed?: number): void;
  stopScenario(): void;
  resetWorld(): void;
  loadScenarios(): Promise<void>;
  loadCircuits(): Promise<void>;
  switchCircuit(id: string): Promise<void>;
  refreshTopology(): Promise<void>;
}


function defaultRole(): ClientRole {
  return { role: "race_control", data: { operator: anonymousOperatorId() } };
}

function anonymousOperatorId(): string {
  const existing = safeStorageGet("tsp_operator_id");
  if (existing) return existing;
  const id = safeRandomUUID();
  safeStorageSet("tsp_operator_id", id);
  return id;
}

export const useStore = create<AppState>((set, get) => {
  const applyEvent = (event: DomainEvent): void => {
    const at = new Date().toISOString();
    const id =
      "id" in event ? (event as { id: string }).id : safeRandomUUID();
    // Only log operational/flag/diagnostic events in Race Control event log.
    // High-frequency telemetry (car_moved) updates car positions directly without cluttering the log.
    if (event.type !== "car_moved") {
      set((s) => ({
        events: [{ id, event, at }, ...s.events].slice(0, 500),
      }));
    }
    switch (event.type) {
      case "panel_state_changed": {
        const panels = { ...get().panels };
        const panel = panels[event.panel as PanelId];
        if (panel) {
          panels[event.panel as PanelId] = {
            ...panel,
            effective_state: event.to,
            last_updated: event.timestamp,
          };
          set({ panels });
        }
        break;
      }
      case "race_control_override_set": {
        const panels = { ...get().panels };
        const panel = panels[event.panel as PanelId];
        if (panel) {
          panels[event.panel as PanelId] = {
            ...panel,
            override_from_rc: event.flag ?? null,
          };
          set({ panels });
        }
        break;
      }
      case "marshal_local_state_set": {
        const panels = { ...get().panels };
        const panel = panels[event.panel as PanelId];
        if (panel) {
          panels[event.panel as PanelId] = {
            ...panel,
            local_state: event.flag ?? null,
          };
          set({ panels });
        }
        break;
      }
      case "diagnostic_alert_raised": {
        const active = { ...get().activeAlerts };
        const list = active[event.alert.panel as PanelId] ?? [];
        active[event.alert.panel as PanelId] = [event.alert, ...list];
        set({ activeAlerts: active });
        break;
      }
      case "diagnostic_alert_cleared": {
        const active = { ...get().activeAlerts };
        const list = (active[event.alert.panel as PanelId] ?? []).filter(
          (a) => JSON.stringify(a) !== JSON.stringify(event.alert)
        );
        active[event.alert.panel as PanelId] = list;
        set({ activeAlerts: active });
        break;
      }
      case "car_moved": {
        const cars = { ...get().cars };
        const num = event.car as number;
        const prev = cars[num];
        cars[num] = {
          number: event.car,
          zone: event.to,
          last_flag: prev?.last_flag ?? "off",
          last_updated: event.timestamp,
        };
        set({ cars });
        break;
      }
      case "ecu_notified": {
        const cars = { ...get().cars };
        const num = event.car as number;
        const prev = cars[num];
        cars[num] = {
          number: event.car,
          zone: prev?.zone ?? event.zone,
          last_flag: event.flag,
          last_updated: event.timestamp,
        };
        set({ cars });
        break;
      }
      default:
        break;
    }
  };

  return {
    topology: null,
    panels: {},
    cars: {},
    role: defaultRole(),
    status: "idle",
    events: [],
    alerts: [],
    activeAlerts: {},
    ecuLights: {},
    client: null,

    mode: "track",
    authRequired: true,
    authenticated: false,
    authRole: null,
    userName: null,
    marshalPost: null,
    marshalRoster: [],

    scenarios: [],
    scenarioRun: null,
    circuits: [],
    activeCircuitId: null,

    async init() {
      if (get().client) return;

      // Restore session if exists
      let initialRole = defaultRole();
      const savedSessionStr = safeStorageGet("tsp_auth_session");
      if (savedSessionStr) {
        try {
          const session = JSON.parse(savedSessionStr);
          if (session && session.role) {
            set({
              authenticated: true,
              userName: session.name || null,
              marshalPost: session.post || null,
              authRole: session.role.role === "marshal" ? "marshal" : "race_control",
            });
            if (session.role.role === "marshal" || session.role.role === "race_control") {
              initialRole = session.role;
            }
          }
        } catch {
          // ignore
        }
      }

      // Fetch server config
      try {
        const cfg: { mode: "track" | "demo"; circuit: string; auth_required: boolean } =
          await fetch("/api/config").then((r) => r.json());
        set({
          mode: cfg.mode,
          authRequired: cfg.auth_required,
          ...(!cfg.auth_required ? { authenticated: true } : {}),
        });
      } catch (e) {
        console.warn("Failed to fetch /api/config", e);
      }

      const topology: CircuitTopology = await fetch("/api/topology").then((r) =>
        r.json()
      );
      const client = new WsClient(buildDefaultUrl(), initialRole);
      client.onStatus((status) => set({ status }));
      client.onMessage((msg) => get().handleMessage(msg));
      client.connect();
      set({ topology, client, role: initialRole, activeCircuitId: topology.name });

      // If restored as marshal, send check-in once connected
      if (get().authenticated && get().marshalPost && get().userName) {
        setTimeout(() => {
          get().checkInMarshal();
        }, 500);
      }

      await Promise.all([get().loadScenarios(), get().loadCircuits()]);
    },

    returnToRaceControl() {
      const savedSessionStr = safeStorageGet("tsp_auth_session");
      let rcRole: ClientRole = defaultRole();
      if (savedSessionStr) {
        try {
          const session = JSON.parse(savedSessionStr);
          if (session?.role?.role === "race_control") {
            rcRole = session.role;
          }
        } catch {
          // ignore
        }
      }
      set({ role: rcRole });
      get().client?.setRole(rcRole);
    },

    async login(params) {
      try {
        const body =
          params.role === "race_control"
            ? { role: "race_control", password: params.password ?? "" }
            : {
                role: "marshal",
                post: Number(params.post),
                name: params.name ?? "",
                pin: params.pin ?? "",
              };

        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || "Error al autenticar" };
        }

        const newRole: ClientRole = data.role;
        const userName: string = data.name;
        const marshalPost = params.role === "marshal" ? Number(params.post) : null;
        const authRole = params.role === "race_control" ? "race_control" : "marshal";

        safeStorageSet(
          "tsp_auth_session",
          JSON.stringify({ role: newRole, name: userName, post: marshalPost })
        );

        set({
          authenticated: true,
          authRole,
          userName,
          marshalPost,
          role: newRole,
        });

        get().client?.setRole(newRole);

        if (marshalPost && userName) {
          get().client?.send({
            type: "marshal_check_in",
            post: marshalPost,
            name: userName,
          });
        }

        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Error de conexión" };
      }
    },

    logout() {
      safeStorageSet("tsp_auth_session", "");
      const defRole = defaultRole();
      set({
        authenticated: false,
        authRole: null,
        userName: null,
        marshalPost: null,
        role: defRole,
      });
      get().client?.setRole(defRole);
    },

    checkInMarshal() {
      const { marshalPost, userName } = get();
      if (marshalPost && userName) {
        get().client?.send({
          type: "marshal_check_in",
          post: marshalPost,
          name: userName,
        });
      }
    },

    resetSession() {
      get().client?.send({ type: "reset_session" });
    },

    async loadScenarios() {
      const scenarios: ScenarioCatalogueEntry[] = await fetch(
        "/api/sim/library"
      ).then((r) => r.json());
      set({ scenarios });
    },

    async loadCircuits() {
      const circuits: CircuitCatalogueEntry[] = await fetch(
        "/api/circuits"
      ).then((r) => r.json());
      set({ circuits });
    },

    async switchCircuit(id) {
      await fetch("/api/circuits/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ circuit_id: id }),
      });
    },

    async refreshTopology() {
      const topology: CircuitTopology = await fetch("/api/topology").then((r) =>
        r.json()
      );
      set({
        topology,
        activeCircuitId: topology.name,
        cars: {},
        panels: {},
        events: [],
      });
      get().client?.send({ type: "request_snapshot" });
    },

    startScenario(name, speed = 1.0) {
      get().client?.send({
        type: "start_scenario",
        name,
        scenario: null,
        speed,
      });
    },

    stopScenario() {
      get().client?.send({ type: "stop_scenario" });
    },

    resetWorld() {
      get().client?.send({ type: "reset_world" });
    },

    setRole(role) {
      set({ role });
      get().client?.setRole(role);
      get().client?.send({ type: "request_snapshot" });
    },

    handleMessage(msg) {
      switch (msg.type) {
        case "welcome":
          break;
        case "snapshot": {
          const indexed: Record<number, Panel> = {};
          for (const p of msg.panels) indexed[p.id] = p;
          const carsIndexed: Record<number, Car> = {};
          for (const c of msg.cars) carsIndexed[c.number as number] = c;
          set({ panels: indexed, cars: carsIndexed });
          break;
        }
        case "marshal_roster": {
          set({ marshalRoster: msg.entries });
          break;
        }
        case "event":
          applyEvent(msg.event);
          break;
        case "diagnostic": {
          const entry: DiagnosticEntry = {
            alert: msg.alert,
            at: new Date().toISOString(),
          };
          set((s) => ({ alerts: [entry, ...s.alerts].slice(0, 200) }));
          break;
        }
        case "ecu_light": {
          const at = new Date().toISOString();
          set((s) => ({
            ecuLights: {
              ...s.ecuLights,
              [msg.car as CarNumber]: { zone: msg.zone, flag: msg.flag, at },
            },
          }));
          break;
        }
        case "scenario_started": {
          set({
            scenarioRun: {
              name: msg.name,
              description: msg.description,
              total_steps: msg.total_steps,
              progress: [],
              marks: [],
              status: "running",
            },
          });
          break;
        }
        case "scenario_progress": {
          const current = get().scenarioRun;
          if (!current) break;
          const entry: ScenarioProgress = {
            step_idx: msg.step_idx,
            total_steps: msg.total_steps,
            mark: msg.mark,
            kind: msg.kind,
            at: new Date().toISOString(),
          };
          const marks = msg.mark
            ? [...current.marks, { step_idx: msg.step_idx, label: msg.mark }]
            : current.marks;
          set({
            scenarioRun: {
              ...current,
              progress: [entry, ...current.progress].slice(0, 200),
              marks,
            },
          });
          break;
        }
        case "scenario_finished": {
          const current = get().scenarioRun;
          if (!current) break;
          set({
            scenarioRun: {
              ...current,
              status:
                msg.reason === "completed"
                  ? "finished"
                  : msg.reason === "stopped"
                    ? "stopped"
                    : "failed",
              result: {
                reason: msg.reason,
                assertions_passed: msg.assertions_passed,
                assertions_failed: msg.assertions_failed,
              },
            },
          });
          break;
        }
        case "scenario_listing": {
          set({ scenarios: msg.entries });
          break;
        }
        case "topology_changed": {
          set({ activeCircuitId: msg.circuit_id });
          void get().refreshTopology();
          break;
        }
        case "circuit_listing": {
          set({ circuits: msg.entries, activeCircuitId: msg.active });
          break;
        }
        case "pong":
          break;
        case "error":
          console.warn("server error", msg);
          break;
      }
    },
  };
});
