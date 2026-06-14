import React from "react";
import { ConstructRuntime, RuntimeMetric } from "../domain/foundry";
import {
  formatRuntimeMemory,
  getLoadedModelSnapshot,
  getRuntimeMemory,
  shortModelId,
} from "../domain/runtimeState";

interface MetricsProps {
  contextWindow: number;
  maxNewTokens: number;
  metrics: RuntimeMetric[];
  runtime?: ConstructRuntime | null;
  trainingMethod: string;
}

const Metrics: React.FC<MetricsProps> = ({
  contextWindow,
  maxNewTokens,
  metrics,
  runtime,
  trainingMethod,
}) => {
  const runtimeStatus = runtime?.loaded ? "Active" : "Idle";
  const loadedModel = getLoadedModelSnapshot(runtime);
  const runtimeMemory = getRuntimeMemory(runtime);
  const runtimeModel = shortModelId(loadedModel.modelId);

  return (
    <section className="metrics-panel" aria-label="Runtime metrics">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Runtime</p>
          <h2>Metrics</h2>
        </div>
        <span className={`status-badge ${runtime?.loaded ? "is-active" : ""}`}>{runtimeStatus}</span>
      </div>

      <div className="metric-list">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className={`metric-row metric-state-${metric.state || "idle"}`}
            title={metric.description}
          >
            <label>
              {metric.label}
              {metric.ideal !== undefined && <small>Ideal {metric.ideal}%</small>}
            </label>
            <div className="metric-track">
              {metric.ideal !== undefined && (
                <span className="metric-ideal-marker" style={{ left: `${metric.ideal}%` }} />
              )}
              <div
                className="metric-fill"
                style={{ width: `${metric.value}%` }}
              />
            </div>
            <span>{metric.value}%</span>
          </div>
        ))}
      </div>

      <div className="runtime-summary">
        <div>
          <span>Status</span>
          <strong>{runtime?.status || "offline"}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{runtime?.mode || "simulated"}</strong>
        </div>
        <div>
          <span>Device</span>
          <strong>{loadedModel.device || runtime?.device || "none"}</strong>
        </div>
        <div>
          <span>Memory</span>
          <strong>{formatRuntimeMemory(runtimeMemory)}</strong>
        </div>
        <div>
          <span>Context</span>
          <strong>{contextWindow.toLocaleString()}</strong>
        </div>
        <div>
          <span>Output cap</span>
          <strong>{maxNewTokens.toLocaleString()}</strong>
        </div>
        <div>
          <span>Adapter</span>
          <strong>{trainingMethod}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{runtimeModel}</strong>
        </div>
      </div>
    </section>
  );
};

export default Metrics;
