// Thrown by an IntentHandler.plan() when planning cannot proceed without more
// information that isn't a simple required slot (e.g. no template matched the
// spoken spec). The WorkflowEngine converts it into a `clarify` outcome.
export class ClarifyError extends Error {
  constructor(
    public readonly question: string,
    public readonly slot: string,
  ) {
    super(question);
    this.name = 'ClarifyError';
  }
}
