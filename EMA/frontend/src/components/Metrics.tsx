import React from "react";
import { RuntimeMetric } from "../domain/foundry";

interface MetricsProps {
  contextWindow: number;
  maxNewTokens: number;
  metrics: RuntimeMetric[];
  trainingMethod: string;
}

const Metrics: React.FC<MetricsProps> = ({
  contextWindow,
  maxNewTokens,
  metrics,
  trainingMethod,
}) => (
    <section className="metrics-panel" aria-label="Runtime metrics">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Runtime</p>
          <h2>Metrics</h2>
        </div>
      </div>

      <div className="metric-list">
        {metrics.map((metric) => (
          <div key={metric.id} className="metric-row">
            <label>{metric.label}</label>
            <div className="metric-track">
              <div
                className="metric-fill"
                style={{ width: `${metric.value}%` }}
              ></div>
            </div>
            <span>{metric.value}%</span>
          </div>
        ))}
      </div>

      <div className="runtime-summary">
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
      </div>
    </section>
);

export default Metrics;
