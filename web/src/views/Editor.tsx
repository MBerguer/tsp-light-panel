import { useState } from "react";
import { TrackMap } from "@/components/TrackMap";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { FlagState } from "@/types/FlagState";
import type { Scenario } from "@/types/Scenario";
import type { ScenarioStep } from "@/types/ScenarioStep";

/**
 * Visual scenario editor — list builder for [`ScenarioStep`]s with inline
 * pickers, JSON export, and "run inline" against the live world via
 * `POST /api/sim/run` (no need to roundtrip through the catalogue).
 */
export function EditorView() {
  const topology = useStore((s) => s.topology);
  const [name, setName] = useState("custom-scenario");
  const [description, setDescription] = useState<string>("Hand-crafted in the editor");
  const [steps, setSteps] = useState<ScenarioStep[]>([
    { step: "race_control_command", target: { scope: "global" }, flag: { kind: "green" } },
    { step: "wait", duration_ms: 1500n },
    { step: "mark", label: "T+1.5s" },
  ]);
  const [speed, setSpeed] = useState(4);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scenario: Scenario = {
    name,
    description,
    setup: {
      panels: [],
      marshals: [],
      cars: [],
      race_control: true,
    },
    steps,
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const next = [...steps];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    setSteps(next);
  };

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx));
  };

  const updateStep = (idx: number, patch: Partial<ScenarioStep>) => {
    const next = [...steps];
    next[idx] = { ...next[idx], ...patch } as ScenarioStep;
    setSteps(next);
  };

  const addStep = (kind: ScenarioStep["step"]) => {
    setSteps([...steps, makeDefault(kind, topology)]);
  };

  const runInline = async () => {
    setError(null);
    setRunning(true);
    try {
      const res = await fetch("/api/sim/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: serialiseScenario(scenario),
          speed,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? res.statusText);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const downloadJson = () => {
    const json = JSON.stringify(serialiseScenario(scenario), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[24rem_1fr]">
      <aside className="card flex flex-col min-h-[350px] lg:h-full overflow-hidden">
        <header className="space-y-2">
          <label className="block text-xs uppercase text-slate-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
          />
          <label className="block text-xs uppercase text-slate-400">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
          />
        </header>
        <div className="mt-3 flex flex-wrap gap-1.5 sm:gap-2">
          <PaletteButton onClick={() => addStep("wait")}>+ Wait</PaletteButton>
          <PaletteButton onClick={() => addStep("mark")}>+ Mark</PaletteButton>
          <PaletteButton onClick={() => addStep("race_control_command")}>
            + RC cmd
          </PaletteButton>
          <PaletteButton onClick={() => addStep("marshal_command")}>
            + Marshal cmd
          </PaletteButton>
          <PaletteButton onClick={() => addStep("enter_zone")}>
            + Enter zone
          </PaletteButton>
          <PaletteButton onClick={() => addStep("park_car")}>
            + Park car
          </PaletteButton>
        </div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {steps.map((step, i) => (
            <StepEditor
              key={i}
              step={step}
              index={i}
              onChange={(patch) => updateStep(i, patch)}
              onMoveUp={() => moveStep(i, -1)}
              onMoveDown={() => moveStep(i, 1)}
              onRemove={() => removeStep(i)}
            />
          ))}
        </div>
        <footer className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 text-slate-400">
              Speed
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 text-xs"
              >
                {[1, 2, 4, 8, 16].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <span className="text-slate-500">{steps.length} steps</span>
          </div>
          <div className="flex gap-2">
            <button
              className="btn flex-1 text-xs sm:text-sm"
              onClick={runInline}
              disabled={running || steps.length === 0}
            >
              {running ? "Sending..." : "Run inline"}
            </button>
            <button className="btn flex-1 text-xs sm:text-sm" onClick={downloadJson}>
              Download JSON
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </footer>
      </aside>
      <div className="flex flex-col gap-4">
        <div className="h-64 sm:h-80 md:h-96 lg:h-[450px]">
          <TrackMap />
        </div>
        <pre className="card max-h-64 overflow-auto text-[10px] text-slate-400">
          {JSON.stringify(serialiseScenario(scenario), null, 2)}
        </pre>
      </div>
    </div>
  );
}

function PaletteButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded bg-sky-500/20 px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/30"
    >
      {children}
    </button>
  );
}

interface StepEditorProps {
  step: ScenarioStep;
  index: number;
  onChange: (patch: Partial<ScenarioStep>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function StepEditor({
  step,
  index,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: StepEditorProps) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-slate-300">
          #{index + 1} {step.step}
        </span>
        <span className="flex items-center gap-1">
          <button onClick={onMoveUp} className="px-1 text-slate-400 hover:text-slate-100">
            ↑
          </button>
          <button onClick={onMoveDown} className="px-1 text-slate-400 hover:text-slate-100">
            ↓
          </button>
          <button onClick={onRemove} className="px-1 text-rose-400 hover:text-rose-200">
            ×
          </button>
        </span>
      </div>
      <div className="mt-1 space-y-1">
        {step.step === "wait" && (
          <NumberField
            label="Duration (ms)"
            value={Number(step.duration_ms)}
            min={0}
            onChange={(v) => onChange({ duration_ms: BigInt(v) } as Partial<ScenarioStep>)}
          />
        )}
        {step.step === "mark" && (
          <TextField
            label="Label"
            value={step.label}
            onChange={(v) => onChange({ label: v } as Partial<ScenarioStep>)}
          />
        )}
        {step.step === "race_control_command" && (
          <>
            <TargetField
              target={step.target}
              onChange={(t) => onChange({ target: t } as Partial<ScenarioStep>)}
            />
            <FlagField
              value={step.flag}
              onChange={(f) => onChange({ flag: f } as Partial<ScenarioStep>)}
            />
          </>
        )}
        {step.step === "marshal_command" && (
          <>
            <NumberField
              label="Post"
              value={step.post}
              min={1}
              onChange={(v) => onChange({ post: v } as Partial<ScenarioStep>)}
            />
            <TargetField
              target={step.target}
              onChange={(t) => onChange({ target: t } as Partial<ScenarioStep>)}
            />
            <FlagField
              value={step.flag}
              onChange={(f) => onChange({ flag: f } as Partial<ScenarioStep>)}
            />
          </>
        )}
        {step.step === "enter_zone" && (
          <>
            <NumberField
              label="Car"
              value={step.car}
              min={1}
              max={99}
              onChange={(v) => onChange({ car: v } as Partial<ScenarioStep>)}
            />
            <NumberField
              label="Zone"
              value={step.zone}
              min={1}
              onChange={(v) => onChange({ zone: v } as Partial<ScenarioStep>)}
            />
          </>
        )}
        {step.step === "park_car" && (
          <NumberField
            label="Car"
            value={step.car}
            min={1}
            max={99}
            onChange={(v) => onChange({ car: v } as Partial<ScenarioStep>)}
          />
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 text-slate-400">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 rounded bg-slate-800 px-2 py-1 text-slate-100"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-slate-800 px-2 py-1 text-slate-100"
      />
    </label>
  );
}

function TargetField({
  target,
  onChange,
}: {
  target: import("@/types/CommandTarget").CommandTarget;
  onChange: (t: import("@/types/CommandTarget").CommandTarget) => void;
}) {
  type Scope = "global" | "sector" | "zone" | "panel";
  const t = target as { scope: Scope; id?: number };
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-slate-400">Target</span>
      <select
        value={t.scope}
        onChange={(e) => {
          const scope = e.target.value as Scope;
          if (scope === "global") onChange({ scope });
          else onChange({ scope, id: 1 } as import("@/types/CommandTarget").CommandTarget);
        }}
        className="rounded bg-slate-800 px-2 py-1 text-slate-100"
      >
        <option value="global">Global</option>
        <option value="sector">Sector</option>
        <option value="zone">Zone</option>
        <option value="panel">Panel</option>
      </select>
      {t.scope !== "global" && (
        <input
          type="number"
          min={1}
          value={t.id ?? 1}
          onChange={(e) =>
            onChange({
              scope: t.scope,
              id: Number(e.target.value),
            } as import("@/types/CommandTarget").CommandTarget)
          }
          className="w-16 rounded bg-slate-800 px-2 py-1 text-slate-100"
        />
      )}
    </div>
  );
}

function FlagField({
  value,
  onChange,
}: {
  value: FlagState;
  onChange: (f: FlagState) => void;
}) {
  const options: FlagState[] = [
    { kind: "off" },
    { kind: "green" },
    { kind: "yellow", data: "single" },
    { kind: "yellow", data: "double" },
    { kind: "yellow_red_striped" },
    { kind: "blue" },
    { kind: "white" },
    { kind: "red" },
    { kind: "safety_car" },
    { kind: "virtual_safety_car" },
    { kind: "vsc_ending" },
    { kind: "chequered" },
  ];
  const currentKey = `${value.kind}-${"data" in value ? value.data : ""}`;
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 text-slate-400">Flag</span>
      <select
        value={currentKey}
        onChange={(e) => {
          const idx = options.findIndex(
            (o) =>
              `${o.kind}-${"data" in o ? (o as { data: string }).data : ""}` ===
              e.target.value
          );
          if (idx >= 0) onChange(options[idx]!);
        }}
        className="flex-1 rounded bg-slate-800 px-2 py-1 text-slate-100"
      >
        {options.map((o) => {
          const key = `${o.kind}-${"data" in o ? (o as { data: string }).data : ""}`;
          return (
            <option key={key} value={key}>
              {describeFlag(o).label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function makeDefault(
  kind: ScenarioStep["step"],
  topology: ReturnType<typeof useStore.getState>["topology"]
): ScenarioStep {
  const firstZone = topology?.zones[0]?.id ?? 1;
  switch (kind) {
    case "wait":
      return { step: "wait", duration_ms: 1000n };
    case "mark":
      return { step: "mark", label: "checkpoint" };
    case "race_control_command":
      return {
        step: "race_control_command",
        target: { scope: "global" },
        flag: { kind: "green" },
      };
    case "marshal_command":
      return {
        step: "marshal_command",
        post: firstZone as number,
        target: { scope: "zone", id: firstZone as number },
        flag: { kind: "yellow", data: "single" },
      };
    case "enter_zone":
      return { step: "enter_zone", car: 44, zone: firstZone as number };
    case "park_car":
      return { step: "park_car", car: 44 };
    default:
      return { step: "mark", label: "todo" };
  }
}

/**
 * Convert the scenario to plain JSON serialisable values. The Rust side
 * expects `duration_ms` as a number, but TypeScript stores it as `bigint`
 * (because `ts-rs` types `u64` that way); `JSON.stringify` cannot encode
 * bigints, so we coerce them to numbers right before sending.
 */
function serialiseScenario(s: Scenario): unknown {
  return {
    ...s,
    steps: s.steps.map((step) =>
      step.step === "wait"
        ? { ...step, duration_ms: Number(step.duration_ms) }
        : step
    ),
  };
}
