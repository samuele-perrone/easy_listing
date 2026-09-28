/**
 * The seller-facing failure for a spent daily quota, in the `error` + `fix`
 * shape `APIClient.checkOK` already renders. Shared so the synchronous route
 * and the background job say the same thing.
 */
export function quotaExhaustedBody() {
  return {
    error: 'Today’s listing generations have run out.',
    fix: 'The free allowance resets daily. Try again tomorrow, or add a paid API key to the backend.',
  };
}

export function genericFailureBody() {
  return {
    error: 'Listing generation failed.',
    fix: 'The AI service was busy. Your photos are saved — tap Retry to try again.',
  };
}
