/**
 * Entry point for the JevOps GitHub Action. See action.yml for the inputs and
 * src/lib/github/action.ts for what a run does. Node runs the TypeScript
 * sources directly, with the same resolver hook as the tests.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { applyActionInputs, resolvePullRequest, runAction, type ActionMessage } from '../src/lib/github/action';

/** Workflow commands end at a newline, so a message must not contain one. */
const escape = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const annotate = ({ level, text }: ActionMessage) => console.log(`::${level}::${escape(text)}`);

function writeOutputs(outputs: Record<string, string>) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [name, value] of Object.entries(outputs)) {
    const delimiter = `JEVOPS_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

async function main(): Promise<number> {
  applyActionInputs(process.env);

  const target = resolvePullRequest(process.env, () =>
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')),
  );
  if (!target.ok) {
    annotate({ level: 'error', text: target.reason });
    return 1;
  }

  console.log(`JevOps: reviewing ${target.value}`);
  const report = await runAction(target.value, process.env.JEVOPS_INPUT_FAIL_ON ?? '');

  report.messages.forEach(annotate);
  writeOutputs(report.outputs);
  if (report.summary && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.summary);
  }
  if (report.outputs.stance) {
    console.log(`JevOps: ${report.outputs.headline} · score ${report.outputs.score} · ${report.outputs.severity}`);
  }
  return report.exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    annotate({ level: 'error', text: `JevOps failed: ${(error as Error).message}` });
    process.exitCode = 1;
  },
);
