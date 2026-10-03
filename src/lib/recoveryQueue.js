// Orders autosaves and clears so stale recovery data can never come back.
//
// An autosave takes a while to build (the song has to be packed). If the user
// saves the song properly in the meantime, the recovery copy is cleared - and
// the autosave that was already under way must not then write its now-stale
// copy back. Every clear() starts a new generation; an autosave only writes if
// the generation it started in is still current, and saves and clears reach
// the backend strictly one at a time, in the order they were requested.

/** backend: { save(meta, data): Promise, clear(): Promise } */
export function createRecoveryQueue(backend) {
  let generation = 0;
  let chain = Promise.resolve();
  const enqueue = (task) => {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  };
  return {
    /** build() resolves to { meta, data }. Resolves true if the copy was written. */
    save(build) {
      const mine = generation;
      return enqueue(async () => {
        if (mine !== generation) return false;
        const { meta, data } = await build();
        if (mine !== generation) return false;
        await backend.save(meta, data);
        return true;
      });
    },
    /** Discards the recovery copy and cancels any autosave still under way. */
    clear() {
      generation++;
      return enqueue(() => backend.clear());
    },
  };
}
