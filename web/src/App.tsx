import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { RaceControlView } from "@/views/RaceControl";
import { MarshalConsoleView } from "@/views/MarshalConsole";
import { EngineeringRoomView } from "@/views/EngineeringRoom";
import { ScenarioPlayerView } from "@/views/ScenarioPlayer";
import { ReplayView } from "@/views/Replay";
import { EditorView } from "@/views/Editor";
import { LoginView } from "@/views/LoginView";
import type { ClientRole } from "@/types/ClientRole";
import { safeRandomUUID, safeStorageGet, safeStorageSet } from "@/lib/uuid";

type TabId =
  | "race_control"
  | "scenario"
  | "editor"
  | "replay"
  | "marshal"
  | "engineering";

export default function App() {
  const init = useStore((s) => s.init);
  const role = useStore((s) => s.role);
  const status = useStore((s) => s.status);
  const setRole = useStore((s) => s.setRole);
  const mode = useStore((s) => s.mode);
  const authRequired = useStore((s) => s.authRequired);
  const authenticated = useStore((s) => s.authenticated);
  const userName = useStore((s) => s.userName);
  const logout = useStore((s) => s.logout);

  const [tab, setTab] = useState<TabId>("race_control");

  useEffect(() => {
    init();
  }, [init]);

  // If marshal logs in, direct them to marshal console
  useEffect(() => {
    if (role.role === "marshal") {
      setTab("marshal");
    } else if (role.role === "race_control" && tab === "marshal" && authRequired) {
      setTab("race_control");
    }
  }, [role.role, authRequired]);

  // Auto-align role with tab in demo mode
  useEffect(() => {
    if (authRequired) return;

    if (
      (tab === "race_control" ||
        tab === "scenario" ||
        tab === "editor") &&
      role.role !== "race_control"
    ) {
      setRole({
        role: "race_control",
        data: { operator: anonymousOperator() },
      });
    } else if (tab === "engineering" && role.role !== "engineering_room") {
      setRole({ role: "engineering_room" });
    } else if (tab === "replay" && role.role !== "spectator") {
      setRole({ role: "spectator" });
    }
  }, [tab, role.role, setRole, authRequired]);

  if (authRequired && !authenticated) {
    return <LoginView />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <Header
        status={status}
        tab={tab}
        setTab={setTab}
        role={role}
        mode={mode}
        userName={userName}
        onLogout={logout}
        authRequired={authRequired}
      />
      <main className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-4">
        {tab === "race_control" && <RaceControlView />}
        {tab === "scenario" && <ScenarioPlayerView />}
        {tab === "editor" && <EditorView />}
        {tab === "replay" && <ReplayView />}
        {tab === "marshal" && <MarshalConsoleView />}
        {tab === "engineering" && <EngineeringRoomView />}
      </main>
    </div>
  );
}

function Header({
  status,
  tab,
  setTab,
  role,
  mode,
  userName,
  onLogout,
  authRequired,
}: {
  status: string;
  tab: TabId;
  setTab: (t: TabId) => void;
  role: ClientRole;
  mode: "track" | "demo";
  userName: string | null;
  onLogout: () => void;
  authRequired: boolean;
}) {
  const statusColour =
    status === "open"
      ? "text-emerald-400"
      : status === "connecting"
        ? "text-yellow-400"
        : "text-red-400";

  const isMarshal = role.role === "marshal";
  const isTrackMode = mode === "track";

  return (
    <header className="flex flex-col border-b border-white/5 bg-slate-900/80 backdrop-blur">
      {/* Top Bar: Brand, Circuit, Status, Role */}
      <div className="flex items-center justify-between px-3 py-2 sm:px-6 sm:py-2.5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-500/20 text-sky-400 font-black text-xs">
            🏁
          </div>
          <h1 className="text-sm font-bold uppercase tracking-wider sm:text-base sm:tracking-widest">
            TSP Light Panel
          </h1>
          <span className="hidden text-[10px] text-slate-500 sm:inline">
            {isTrackMode ? "PISTA REAL · BORRAT FABINI" : "SIMULADOR / DEMO"}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-xs">
          {!isTrackMode && <CircuitPicker />}
          <span className={`font-mono text-xs font-bold uppercase ${statusColour}`} title={`WS status: ${status}`}>
            ● <span className="hidden sm:inline">{status}</span>
          </span>
          {userName && (
            <span className="rounded bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
              {userName}
            </span>
          )}
          <span className="hidden md:inline rounded bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-400">
            {describeRole(role)}
          </span>
          {authRequired && (
            <button
              onClick={onLogout}
              className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition-colors"
              title="Cerrar sesión"
            >
              Salir
            </button>
          )}
        </div>
      </div>

      {/* Tabs Navigation: Horizontal scrolling on mobile, centered/clean on desktop */}
      <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-white/5 px-2 py-1.5 sm:px-6">
        {isTrackMode && isMarshal ? (
          <TabButton id="marshal" current={tab} onClick={setTab}>
            Puesto #{role.data.post}
          </TabButton>
        ) : isTrackMode ? (
          <>
            <TabButton id="race_control" current={tab} onClick={setTab}>
              Control de Carrera
            </TabButton>
            <TabButton id="marshal" current={tab} onClick={setTab}>
              Consola Comisario
            </TabButton>
            <TabButton id="engineering" current={tab} onClick={setTab}>
              Diagnóstico / Salud
            </TabButton>
          </>
        ) : (
          <>
            <TabButton id="race_control" current={tab} onClick={setTab}>
              Race Control
            </TabButton>
            <TabButton id="scenario" current={tab} onClick={setTab}>
              Scenarios
            </TabButton>
            <TabButton id="editor" current={tab} onClick={setTab}>
              Editor
            </TabButton>
            <TabButton id="replay" current={tab} onClick={setTab}>
              Replay
            </TabButton>
            <TabButton id="marshal" current={tab} onClick={setTab}>
              Marshal
            </TabButton>
            <TabButton id="engineering" current={tab} onClick={setTab}>
              Engineering
            </TabButton>
          </>
        )}
      </nav>
    </header>
  );
}

function CircuitPicker() {
  const circuits = useStore((s) => s.circuits);
  const active = useStore((s) => s.activeCircuitId);
  const role = useStore((s) => s.role);
  const switchCircuit = useStore((s) => s.switchCircuit);

  if (circuits.length === 0) return null;
  const canSwitch = role.role === "race_control";
  return (
    <select
      className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50 max-w-[130px] sm:max-w-none truncate"
      value={active ?? ""}
      onChange={(e) => switchCircuit(e.target.value)}
      disabled={!canSwitch}
      title={canSwitch ? "Switch circuit" : "Switch from Race Control to change circuits"}
    >
      {circuits.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

function TabButton({
  id,
  current,
  onClick,
  children,
}: {
  id: TabId;
  current: TabId;
  onClick: (t: TabId) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold sm:px-3.5 sm:py-1.5 sm:text-sm transition-colors ${
        current === id
          ? "border border-sky-400 bg-sky-500/15 text-sky-200"
          : "border border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
      onClick={() => onClick(id)}
    >
      {children}
    </button>
  );
}

function describeRole(role: ClientRole): string {
  switch (role.role) {
    case "race_control":
      return `RC operator ${role.data.operator.slice(0, 8)}`;
    case "marshal":
      return `Marshal post #${role.data.post}`;
    case "engineering_room":
      return "Engineering Room";
    case "spectator":
      return "Spectator";
  }
}

function anonymousOperator(): string {
  const existing = safeStorageGet("tsp_operator_id");
  if (existing) return existing;
  const id = safeRandomUUID();
  safeStorageSet("tsp_operator_id", id);
  return id;
}
