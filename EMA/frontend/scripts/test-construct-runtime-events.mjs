import { readFile } from "node:fs/promises";

const files = {
  domain: await readFile(new URL("../src/domain/foundry.ts", import.meta.url), "utf8"),
  repository: await readFile(
    new URL("../src/services/foundryRepository.ts", import.meta.url),
    "utf8"
  ),
  contracts: await readFile(new URL("../src/contracts/foundryApi.ts", import.meta.url), "utf8"),
  construct: await readFile(
    new URL("../src/components/ConstructWorkbench.tsx", import.meta.url),
    "utf8"
  ),
  settings: await readFile(
    new URL("../src/components/SettingsOverlay.tsx", import.meta.url),
    "utf8"
  ),
};

const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected to find "${expected}"`);
  }
};

assertIncludes(
  files.domain,
  "export interface ConstructRuntimeEvent",
  "Runtime event domain contract"
);
assertIncludes(
  files.domain,
  "export type CreateConstructRuntimeEventRequest",
  "Runtime event creation contract"
);
assertIncludes(
  files.repository,
  "listConstructRuntimeEvents:",
  "Repository list method"
);
assertIncludes(
  files.repository,
  "recordConstructRuntimeEvent:",
  "Repository record method"
);
assertIncludes(
  files.repository,
  "mockConstructRuntimeEvents",
  "Mock runtime event storage"
);
assertIncludes(
  files.repository,
  "constructApiFoundryRepository",
  "Construct API hybrid repository"
);
assertIncludes(
  files.repository,
  "dataSource === \"construct-api\"",
  "Construct API data source switch"
);
assertIncludes(
  files.contracts,
  "constructRuntimeEvents:",
  "Runtime event API route"
);
assertIncludes(
  files.construct,
  ".listConstructRuntimeEvents()",
  "Construct timeline hydration"
);
assertIncludes(
  files.construct,
  "refreshRuntimeTimeline",
  "Construct timeline backend refresh"
);
assertIncludes(
  files.construct,
  "window.setInterval(pollTimeline",
  "Construct timeline active polling"
);
assertIncludes(
  files.construct,
  "activeFoundryDataSource",
  "Construct runtime source indicator"
);
assertIncludes(
  files.settings,
  "Runtime Source",
  "Settings runtime source panel"
);
assertIncludes(
  files.settings,
  "activeFoundryDataSource",
  "Settings data source mode"
);
assertIncludes(
  files.construct,
  ".recordConstructRuntimeEvent({",
  "Construct timeline persistence"
);
