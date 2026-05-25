import { spawn } from "bun";
import { Effect, Layer } from "effect";

import { CommandExecutionFailed } from "./errors";
import { CommandExecutor } from "./services";
import type { CommandInput, CommandResult } from "./types";

const textDecoder = new TextDecoder();

export const CommandExecutorLive = Layer.succeed(CommandExecutor, {
  run: (input) =>
    Effect.tryPromise({
      catch: (error) =>
        new CommandExecutionFailed({
          args: input.args,
          binary: input.binary,
          message:
            error instanceof Error
              ? error.message
              : "Command failed before it could start.",
        }),
      try: () => runCommand(input),
    }).pipe(
      Effect.flatMap((result) => {
        if (result.exitCode === 0) {
          return Effect.succeed(result);
        }

        return Effect.fail(
          new CommandExecutionFailed({
            args: input.args,
            binary: input.binary,
            exitCode: result.exitCode,
            message: `Command exited with code ${result.exitCode}.`,
            stderr: result.stderr,
          })
        );
      })
    ),
});

const runCommand = async (input: CommandInput): Promise<CommandResult> => {
  const process = spawn([input.binary, ...input.args], {
    cwd: input.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdoutBuffer, stderrBuffer, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).arrayBuffer(),
    process.exited,
  ]);

  return {
    args: input.args,
    binary: input.binary,
    exitCode,
    stderr: textDecoder.decode(stderrBuffer),
    stdout: textDecoder.decode(stdoutBuffer),
  };
};
