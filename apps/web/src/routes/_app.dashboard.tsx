import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { matchWithError } from "effect/unstable/reactivity/AsyncResult";

import { privateDataAtom } from "@/utils/api";

export const Route = createFileRoute("/_app/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const privateData = useAtomValue(privateDataAtom);
  const privateDataMessage = matchWithError(privateData, {
    onDefect: () => "Unable to load private data",
    onError: (error) => error.message,
    onInitial: () => "Loading...",
    onSuccess: ({ value }) => value.message,
  });

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
      <p>API: {privateDataMessage}</p>
    </div>
  );
}
