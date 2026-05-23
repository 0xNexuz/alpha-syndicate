import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Bot,
  CircleDollarSign,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Network,
  Play,
  RadioTower,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Zap
} from "lucide-react";
import "./styles.css";

type LogEntry = {
  label: string;
  detail: string;
  status: "idle" | "live" | "done" | "warn";
};

type RunResult = {
  invoiceHash: string;
  paymentAuth: {
    userOperationHash: string;
    signaturePreview: string;
  };
  receipt: {
    txHash: string;
  };
  proof: {
    type: string;
    commitment: string;
    privacyProof: string;
  };
  signal?: Record<string, unknown>;
  privatePayload?: unknown;
  balances: {
    before: WalletSnapshot;
    after: WalletSnapshot;
  };
  timeline: Array<{
    step: string;
    status: "done" | "live" | "warn";
    detail: string;
    at: string;
  }>;
};

type WalletSnapshot = {
  arc: {
    walletId: string;
    address: string;
    usdc: number;
    eurc: number;
  };
  source: {
    walletId: string;
    address: string;
    usdc: number;
  };
};

const initialLogs: LogEntry[] = [
  { label: "KYB", detail: "Execution Agent approved, risk score below policy threshold", status: "done" },
  { label: "Gateway", detail: "Oracle route protected by x402 payment middleware", status: "live" },
  { label: "Wallets", detail: "Agent wallets mapped to Arc Testnet and Base Sepolia", status: "idle" }
];

const gatewayBaseUrl = import.meta.env.VITE_GATEWAY_URL ?? "";

function App() {
  useScrollReveal();

  const [logs, setLogs] = useState(initialLogs);
  const [isRunning, setIsRunning] = useState(false);
  const [signal, setSignal] = useState<Record<string, unknown> | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false);

  const statusCounts = useMemo(() => ({
    live: logs.filter((log) => log.status === "live").length,
    done: logs.filter((log) => log.status === "done").length
  }), [logs]);

  async function runPaymentFlow() {
    setIsRunning(true);
    setSignal(null);
    setRunResult(null);
    setLogs([
      { label: "Request", detail: "Execution Agent is starting server-side wallet orchestration", status: "live" }
    ]);

    try {
      const result = await apiJson<RunResult>("/api/agent/run-signal", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "execution-agent-007" },
        body: JSON.stringify({ market: "BTC-USDC", privacy: privacyMode })
      });

      if (!result.timeline) {
        throw new Error("Agent run failed before returning a timeline.");
      }

      setRunResult(result);
      setSignal(result.signal ?? null);
      setLogs([]);
      for (const [index, entry] of result.timeline.entries()) {
        window.setTimeout(() => {
          pushLog(entry.step, entry.detail, entry.status);
        }, index * 180);
      }
    } catch (error) {
      pushLog("Error", error instanceof Error ? error.message : "Unknown failure", "warn");
    } finally {
      setIsRunning(false);
    }
  }

  function pushLog(label: string, detail: string, status: LogEntry["status"]) {
    setLogs((current) => [...current, { label, detail, status }]);
  }

  return (
    <main>
      <section className="hero-section">
        <nav className="nav reveal" style={revealDelay("40ms")}>
          <div className="brand"><span /> Alpha Syndicate</div>
          <div className="nav-actions">
            <a href="#architecture">Architecture</a>
            <a href="#console">Console</a>
            <a href="#settlement">Settlement</a>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy reveal" style={revealDelay("120ms")}>
            <p className="eyebrow">Canteen x Circle Hackathon</p>
            <h1>Paid machine alpha, settled in USDC.</h1>
            <p className="hero-lede">
              A gateway for autonomous agents to price, buy, and unlock high-conviction research signals with x402, Circle Wallets, CCTP, FX, and sponsored Arc settlement.
            </p>
            <div className="hero-actions">
              <button onClick={runPaymentFlow} disabled={isRunning}>
                <Play size={18} /> {isRunning ? "Running flow" : "Run demo flow"}
              </button>
              <button className="ghost-button" onClick={() => setPrivacyMode((current) => !current)} type="button">
                <EyeOff size={18} /> Privacy {privacyMode ? "on" : "off"}
              </button>
              <a href="#architecture">View system <ArrowRight size={16} /></a>
            </div>
          </div>

          <div className="hero-visual reveal" style={revealDelay("260ms")} aria-label="Agent payment routing visual">
            <div className="orbital orbital-one"><Bot size={22} /> Execution Agent</div>
            <div className="orbital orbital-two"><RadioTower size={22} /> Oracle Agent</div>
            <div className="settlement-core">
              <CircleDollarSign size={42} />
              <span>x402</span>
              <strong>0.25 USDC</strong>
            </div>
            <div className="route-line route-a" />
            <div className="route-line route-b" />
          </div>
        </div>
      </section>

      <section className="trust-strip reveal">
        {[
          ["Circle Wallets", WalletCards],
          ["CCTP Funding", Network],
          ["StableFX", Zap],
          ["Paymaster", KeyRound],
          ["Privacy Proof", EyeOff]
        ].map(([label, Icon]) => (
          <div key={label as string}><Icon size={18} /> {label as string}</div>
        ))}
      </section>

      <section id="architecture" className="architecture-section">
        <div className="section-heading reveal">
          <p className="eyebrow">System architecture</p>
          <h2>Eight primitives, one paid signal route.</h2>
        </div>
        <div className="bento-grid">
          {[
            ["Compliance Gate", "KYB/KYC mock policy before any Oracle quote.", ShieldCheck],
            ["x402 Invoice", "HTTP 402 returns amount, network, recipient, nonce, and privacy commitment.", ReceiptText],
            ["CCTP Refill", "Execution Agent moves USDC from Base Sepolia into Arc operations.", Network],
            ["FX at Payment", "EURC fallback converts into USDC when settlement requires it.", CircleDollarSign],
            ["Paymaster", "Sponsored UserOp envelope keeps gas invisible to the agent.", KeyRound],
            ["Private Unlock", "Signal payload can be encrypted with a commitment proof.", LockKeyhole]
          ].map(([title, body, Icon], index) => (
            <article
              key={title as string}
              className="bento-card reveal"
              style={revealDelay(`${index * 70}ms`)}
            >
              <Icon size={24} />
              <h3>{title as string}</h3>
              <p>{body as string}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="console" className="console-section">
        <div className="console-panel reveal">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live execution</p>
              <h2>Agent payment console</h2>
            </div>
            <button onClick={runPaymentFlow} disabled={isRunning}>
              <Play size={18} /> Start
            </button>
          </div>
          <div className="log-list">
            {logs.map((log, index) => (
              <div className={`log-row ${log.status}`} key={`${log.label}-${index}`}>
                <span>{log.label}</span>
                <p>{log.detail}</p>
              </div>
            ))}
          </div>
          {runResult && (
            <div className="artifact-grid">
              <div>
                <span>Invoice hash</span>
                <strong>{shortHash(runResult.invoiceHash)}</strong>
              </div>
              <div>
                <span>UserOp</span>
                <strong>{shortHash(runResult.paymentAuth.userOperationHash)}</strong>
              </div>
              <div>
                <span>Wallet sig</span>
                <strong>{runResult.paymentAuth.signaturePreview}</strong>
              </div>
            </div>
          )}
        </div>

        <aside className="signal-card reveal" style={revealDelay("120ms")}>
          <p className="eyebrow">Oracle output</p>
          <h3>{signal ? String(signal.action) : "Locked"}</h3>
          <div className="signal-market">{signal ? String(signal.market) : "BTC-USDC"}</div>
          <dl>
            <div><dt>Conviction</dt><dd>{signal ? `${Number(signal.conviction) * 100}%` : "--"}</dd></div>
            <div><dt>Horizon</dt><dd>{signal ? String(signal.horizon) : "--"}</dd></div>
            <div><dt>Max size</dt><dd>{signal ? `$${signal.maxPositionUsd}` : "--"}</dd></div>
          </dl>
          <p>
            {signal
              ? String(signal.researchSource)
              : runResult?.privatePayload
                ? "Encrypted payload returned. The agent can decrypt with its private delivery key."
                : "Pay the x402 invoice to reveal the trading signal."}
          </p>
        </aside>
      </section>

      {runResult && (
        <section className="wallet-section reveal">
          <div>
            <p className="eyebrow">Agent treasury</p>
            <h2>Funding state before and after settlement.</h2>
          </div>
          <div className="wallet-grid">
            <WalletCard title="Before" snapshot={runResult.balances.before} />
            <WalletCard title="After" snapshot={runResult.balances.after} />
          </div>
        </section>
      )}

      <section id="settlement" className="settlement-section">
        <div className="settlement-copy reveal">
          <p className="eyebrow">Settlement proof</p>
          <h2>Receipts become routing credentials.</h2>
          <p>
            The `x-payment` receipt is presented back to the Gateway. Once verified, the Oracle route returns either clear JSON or an encrypted payload for the approved agent.
          </p>
        </div>
        <div className="receipt-stack reveal" style={revealDelay("120ms")}>
          <div><BadgeCheck size={20} /> KYB approved</div>
          <div><Sparkles size={20} /> {statusCounts.done} completed steps</div>
          <div><Blocks size={20} /> {runResult ? String(runResult.receipt.txHash).slice(0, 18) : "No payment yet"}</div>
          <div><EyeOff size={20} /> {runResult ? shortHash(runResult.proof.privacyProof) : "No proof yet"}</div>
        </div>
      </section>
    </main>
  );
}

function WalletCard({ title, snapshot }: { title: string; snapshot: WalletSnapshot }) {
  return (
    <article className="wallet-card">
      <h3>{title}</h3>
      <dl>
        <div><dt>Arc USDC</dt><dd>{snapshot.arc.usdc.toFixed(2)}</dd></div>
        <div><dt>Arc EURC</dt><dd>{snapshot.arc.eurc.toFixed(2)}</dd></div>
        <div><dt>Source USDC</dt><dd>{snapshot.source.usdc.toFixed(2)}</dd></div>
      </dl>
      <p>{shortHash(snapshot.arc.address)}</p>
    </article>
  );
}

function useScrollReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}

function revealDelay(delay: string): CSSProperties {
  return { "--delay": delay } as CSSProperties;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${gatewayBaseUrl}${path}`, init);
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(`API returned ${response.status} ${response.statusText}: ${text.slice(0, 120)}`);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `API returned ${response.status}`);
  }

  return data as T;
}

function shortHash(value: string) {
  if (value.length <= 22) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export default App;
