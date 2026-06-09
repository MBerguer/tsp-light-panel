import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { DiagnosticAlert } from "@/types/DiagnosticAlert";

/**
 * Engineering Room dashboard. Two columns:
 *
 * * **Health table** — one row per panel showing PSU, temperature, LED
 *   failures, handshake freshness and the currently-displayed flag.
 * * **Alert feed** — chronological list of `DiagnosticAlertRaised` events
 *   colour-coded by severity.
 */
export function EngineeringRoomView() {
  const panels = useStore((s) => Object.values(s.panels));
  const alerts = useStore((s) => s.alerts);

  return (
    <div className="grid h-full grid-cols-12 gap-4">
      <div className="col-span-8 card flex flex-col gap-3 overflow-hidden">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Panel health
        </h3>
        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/80 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Zone</th>
                <th className="px-2 py-2 text-left">Flag</th>
                <th className="px-2 py-2 text-right">PSU (V)</th>
                <th className="px-2 py-2 text-right">Temp (°C)</th>
                <th className="px-2 py-2 text-right">LED fails</th>
                <th className="px-2 py-2 text-left">Handshake</th>
              </tr>
            </thead>
            <tbody>
              {panels
                .sort((a, b) => Number(a.id) - Number(b.id))
                .map((p) => {
                  const d = describeFlag(p.effective_state);
                  return (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className="px-2 py-2 font-mono">#{p.id}</td>
                      <td className="px-2 py-2 text-slate-400">Z{p.zone}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-bold ${d.bg} ${d.fg}`}
                        >
                          {d.label}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          p.hardware.psu_voltage < 45 ||
                          p.hardware.psu_voltage > 52
                            ? "text-red-400"
                            : "text-slate-200"
                        }`}
                      >
                        {p.hardware.psu_voltage.toFixed(1)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          p.hardware.temperature_c >= 75
                            ? "text-red-400"
                            : "text-slate-200"
                        }`}
                      >
                        {p.hardware.temperature_c.toFixed(1)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-mono ${
                          p.hardware.led_failures.length > 0
                            ? "text-yellow-400"
                            : "text-slate-200"
                        }`}
                      >
                        {p.hardware.led_failures.length}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-400">
                        {new Date(p.hardware.last_handshake).toLocaleTimeString()}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="col-span-4 card flex flex-col gap-3 overflow-hidden">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Alerts ({alerts.length})
        </h3>
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {alerts.length === 0 && (
            <div className="text-xs text-slate-500">All systems nominal.</div>
          )}
          {alerts.map((a, i) => (
            <AlertRow key={i} alert={a.alert} at={a.at} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function AlertRow({ alert, at }: { alert: DiagnosticAlert; at: string }) {
  const sev = alertSeverityColour(alert.severity);
  return (
    <div className="rounded-md border border-white/5 bg-slate-900/60 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className={`font-bold uppercase ${sev}`}>{alert.severity}</span>
        <span className="text-slate-500">
          {new Date(at).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-1 text-slate-200">
        Panel #{alert.panel} — {alertSummary(alert)}
      </div>
    </div>
  );
}

function alertSummary(alert: DiagnosticAlert): string {
  switch (alert.kind) {
    case "psu_out_of_range":
      return `PSU ${alert.voltage.toFixed(1)} V out of range`;
    case "overtemperature":
      return `temperature ${alert.celsius.toFixed(1)} °C`;
    case "led_failure":
      return `${alert.leds.length} LED(s) failed`;
    case "handshake_timeout":
      return `handshake timeout ${alert.elapsed_ms} ms`;
  }
}

function alertSeverityColour(s: import("@/types/DiagnosticSeverity").DiagnosticSeverity): string {
  switch (s) {
    case "critical":
      return "text-red-400";
    case "warning":
      return "text-yellow-400";
    case "info":
      return "text-sky-400";
  }
}
