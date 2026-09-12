import { useState } from "react";
import { useStore } from "@/lib/store";

export function LoginView() {
  const login = useStore((s) => s.login);
  const topology = useStore((s) => s.topology);

  const [activeTab, setActiveTab] = useState<"marshal" | "race_control">("marshal");
  const [selectedPost, setSelectedPost] = useState<number>(1);
  const [marshalName, setMarshalName] = useState<string>("");
  const [marshalPin, setMarshalPin] = useState<string>("1234");
  const [rcPassword, setRcPassword] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // 1 to 16 AUVO posts
  const availablePosts = topology?.zones?.length
    ? topology.zones.map((z) => z.id).sort((a, b) => a - b)
    : Array.from({ length: 16 }, (_, i) => i + 1);

  const handleMarshalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const res = await login({
        role: "marshal",
        post: selectedPost,
        name: marshalName.trim() || `Comisario Puesto #${selectedPost}`,
        pin: marshalPin.trim(),
      });
      if (!res.ok) {
        setErrorMsg(res.error || "PIN incorrecto o error de acceso");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const res = await login({
        role: "race_control",
        password: rcPassword,
      });
      if (!res.ok) {
        setErrorMsg(res.error || "Contraseña de Race Control incorrecta");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Track / Venue Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 to-indigo-600 shadow-lg shadow-sky-500/20">
            <span className="text-2xl">🏁</span>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-wider text-slate-100">
            TSP Light Panel
          </h1>
          <p className="text-sm font-semibold text-sky-400">
            Autódromo Víctor Borrat Fabini · Circuito N° 13
          </p>
          <p className="text-xs text-slate-500">
            Asociación Uruguaya de Volantes (AUVO)
          </p>
        </div>

        {/* Role Toggle Tabs */}
        <div className="grid grid-cols-2 rounded-xl bg-slate-900 p-1 border border-slate-800">
          <button
            type="button"
            className={`rounded-lg py-2.5 text-xs sm:text-sm font-bold transition-all ${
              activeTab === "marshal"
                ? "bg-sky-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => {
              setActiveTab("marshal");
              setErrorMsg(null);
            }}
          >
            🚩 Comisario de Pista
          </button>
          <button
            type="button"
            className={`rounded-lg py-2.5 text-xs sm:text-sm font-bold transition-all ${
              activeTab === "race_control"
                ? "bg-sky-600 text-white shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
            onClick={() => {
              setActiveTab("race_control");
              setErrorMsg(null);
            }}
          >
            🛡️ Race Control
          </button>
        </div>

        {/* Card Form */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur">
          {errorMsg && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs font-semibold text-red-300">
              ⚠️ {errorMsg}
            </div>
          )}

          {activeTab === "marshal" ? (
            <form onSubmit={handleMarshalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Seleccionar Puesto de Bandera
                </label>
                <select
                  value={selectedPost}
                  onChange={(e) => setSelectedPost(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base font-bold text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  {availablePosts.map((p) => (
                    <option key={p} value={p}>
                      Puesto #{p} {p === 1 ? "(Recta Principal)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Nombre del Comisario
                </label>
                <input
                  type="text"
                  placeholder="Ej: Marcelo García"
                  value={marshalName}
                  onChange={(e) => setMarshalName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  autoComplete="name"
                />
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    PIN de Seguridad
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Por defecto: 1234
                  </span>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="1234"
                  value={marshalPin}
                  onChange={(e) => setMarshalPin(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base font-mono tracking-widest text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 py-3.5 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-sky-600/30 hover:from-sky-500 hover:to-indigo-500 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isLoading ? "Conectando..." : `Ingresar al Puesto #${selectedPost}`}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRcSubmit} className="space-y-4">
              <div>
                <div className="flex justify-between items-baseline mb-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                    Contraseña de Control de Carrera
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Por defecto: control123
                  </span>
                </div>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={rcPassword}
                  onChange={(e) => setRcPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base font-mono text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isLoading ? "Validando..." : "Acceder a Race Control"}
              </button>
            </form>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-600">
          FIA Standard 3504-2019 · Panel de Señalización Luminosa
        </p>
      </div>
    </div>
  );
}
