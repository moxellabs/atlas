import { AGENT_INTEGRATIONS, getAgentIntegration } from "./catalog";
import { readOptional } from "./file-operations";
import { canonicalMutationPath, integrationLockPath } from "./locks";
import {
  allOperationsMatch,
  assertReceiptMatchesPlan,
} from "./operation-validation";
import { errorMessage, integrationReceiptPath, readReceipt } from "./receipts";
import {
  extractVersion,
  resolveExecutable,
  runIntegrationCommand,
  versionAtLeast,
} from "./runtime";
import type {
  AgentClientId,
  AgentDetectionResult,
  AgentDoctorResult,
  AgentIntegrationScope,
  IntegrationEnvironment,
} from "./types";

export async function detectAgentIntegrations(
  environment: IntegrationEnvironment,
): Promise<readonly AgentDetectionResult[]> {
  return Promise.all(
    AGENT_INTEGRATIONS.map(async (descriptor) => {
      const executablePath =
        descriptor.executable === undefined
          ? undefined
          : await resolveExecutable(descriptor.executable, environment.path);
      const configuredScopes = await configuredScopesFor(
        descriptor.id,
        environment,
      );
      let version: string | undefined;
      let versionProbeError: string | undefined;
      if (executablePath !== undefined) {
        try {
          const result = await (
            environment.runCommand ?? runIntegrationCommand
          )([executablePath, "--version"], {
            cwd: environment.workspaceDir,
            env: environment.env,
          });
          if (result.exitCode === 0) {
            version = extractVersion(`${result.stdout}\n${result.stderr}`);
            if (version === undefined)
              versionProbeError = "Version probe returned no semantic version.";
          } else {
            versionProbeError = `Version probe exited with code ${result.exitCode}.`;
          }
        } catch (error) {
          versionProbeError = `Version probe failed: ${errorMessage(error)}.`;
        }
      }
      return {
        clientId: descriptor.id,
        displayName: descriptor.displayName,
        installed: executablePath !== undefined || configuredScopes.length > 0,
        ...(executablePath === undefined ? {} : { executablePath }),
        ...(version === undefined ? {} : { version }),
        ...(descriptor.minimumVersion === undefined
          ? {}
          : {
              versionSupported:
                versionProbeError === undefined &&
                version !== undefined &&
                versionAtLeast(version, descriptor.minimumVersion),
            }),
        ...(versionProbeError === undefined ? {} : { versionProbeError }),
        configuredScopes,
      };
    }),
  );
}

export async function doctorAgentIntegration(
  clientId: AgentClientId,
  scope: AgentIntegrationScope,
  environment: IntegrationEnvironment,
): Promise<AgentDoctorResult> {
  const detections = await detectAgentIntegrations(environment);
  const detection = detections.find((item) => item.clientId === clientId);
  if (detection === undefined)
    throw new Error(`Detection result missing for ${clientId}.`);
  const descriptor = getAgentIntegration(clientId);
  if (descriptor[scope] === undefined) {
    const supported = (["user", "workspace"] as const)
      .filter((candidate) => descriptor[candidate] !== undefined)
      .join(", ");
    return {
      detection,
      scope,
      healthy: false,
      receiptPresent: false,
      issues: [
        `${descriptor.displayName} does not support ${scope}-scope MCP configuration.`,
      ],
      nextActions: [`Use a supported scope: ${supported}.`],
    };
  }
  const issues: string[] = [];
  const nextActions: string[] = [];
  const receiptPath = integrationReceiptPath(
    environment.homeDir,
    clientId,
    scope,
    environment.workspaceDir,
  );
  const lockPath = integrationLockPath(
    environment.homeDir,
    await canonicalMutationPath(receiptPath),
  );
  if ((await readOptional(lockPath)) !== undefined) {
    issues.push(`An integration transaction lock is present at ${lockPath}.`);
    nextActions.push(
      "Verify the recorded owner process is no longer running before removing the lock.",
    );
  }
  const receipt = await readReceipt(receiptPath);
  let receiptValid = false;
  if (receipt !== undefined) {
    try {
      assertReceiptMatchesPlan(receipt, environment, clientId, scope);
      receiptValid = true;
    } catch (error) {
      issues.push(errorMessage(error));
      nextActions.push(
        `Remove the invalid receipt at ${receiptPath} and reinstall Atlas.`,
      );
    }
  }
  if (
    receiptValid &&
    !(await allOperationsMatch(receipt?.operations ?? [], environment))
  ) {
    issues.push(
      `${detection.displayName} configuration has drifted from the Atlas-managed receipt.`,
    );
    nextActions.push(
      `Remove and reinstall the ${scope}-scope Atlas integration.`,
    );
  }
  if (!detection.installed) {
    issues.push(`${detection.displayName} was not detected.`);
    nextActions.push(`Install ${detection.displayName}, then rerun doctor.`);
  }
  if (detection.versionSupported === false) {
    const minimum = getAgentIntegration(clientId).minimumVersion;
    issues.push(
      detection.versionProbeError ??
        `${detection.displayName} ${detection.version ?? "unknown"} is below supported version ${minimum ?? "unknown"}.`,
    );
    nextActions.push(
      detection.versionProbeError === undefined
        ? `Upgrade ${detection.displayName}.`
        : `Verify ${detection.displayName} can run --version, then rerun doctor.`,
    );
  }
  if (receipt === undefined) {
    issues.push(`No Atlas-managed ${scope}-scope integration receipt exists.`);
    nextActions.push(
      `Run atlas agent install ${clientId} --scope ${scope} --mode discoverable.`,
    );
  }
  return {
    detection,
    scope,
    healthy: issues.length === 0,
    receiptPresent: receipt !== undefined,
    issues,
    nextActions,
  };
}

async function configuredScopesFor(
  clientId: AgentClientId,
  environment: IntegrationEnvironment,
): Promise<readonly AgentIntegrationScope[]> {
  const scopes: AgentIntegrationScope[] = [];
  for (const scope of ["user", "workspace"] as const) {
    if (
      (await readOptional(
        integrationReceiptPath(
          environment.homeDir,
          clientId,
          scope,
          environment.workspaceDir,
        ),
      )) !== undefined
    )
      scopes.push(scope);
  }
  return scopes;
}
