import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { RaceControlView } from "@/views/RaceControl";
import { MarshalConsoleView } from "@/views/MarshalConsole";
import { EngineeringRoomView } from "@/views/EngineeringRoom";
import { ScenarioPlayerView } from "@/views/ScenarioPlayer";
import { ReplayView } from "@/views/Replay";
import { EditorView } from "@/views/Editor";
import type { ClientRole } from "@/types/ClientRole";

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
  const [tab, setTab] = useState<TabId>("race_control");

  useEffect(() => {
    init();
  }, [init]);

  // Auto-align role with tab so commands always carry a consistent source.
  useEffect(() => {
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
  }, [tab, role.role, setRole]);

  return (
    <div className="flex h-screen flex-col">
      <Header status={status} tab={tab} setTab={setTab} role={role} />
      <main className="flex-1 overflow-hidden p-4">
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
}: {
  status: string;
  tab: TabId;
  setTab: (t: TabId) => void;
  role: ClientRole;
}) {
  const statusColour =
    status === "open"
      ? "text-emerald-400"
      : status === "connecting"
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <header className="flex items-center justify-between border-b border-white/5 bg-slate-900/60 px-6 py-3 backdrop-blur">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-bold uppercase tracking-widest">
          TSP Light Panel
        </h1>
        <span className="text-xs text-slate-500">
          FIA Standard 3504-2019 demo
        </span>
      </div>
      <nav className="flex items-center gap-2">
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
      </nav>
      <div className="flex items-center gap-3 text-xs">
        <CircuitPicker />
        <span className={`font-mono uppercase ${statusColour}`}>● {status}</span>
        <span className="text-slate-400">{describeRole(role)}</span>
      </div>
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
      className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
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
      className={`btn ${
        current === id ? "border-sky-400 bg-sky-400/10 text-sky-200" : ""
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
  const existing = sessionStorage.getItem("tsp_operator_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem("tsp_operator_id", id);
  return id;
}
