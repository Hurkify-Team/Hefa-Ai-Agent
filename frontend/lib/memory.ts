export function memorySnapshot() {
  const usage = process.memoryUsage();
  const mb = (value: number) => Math.round((value / 1024 / 1024) * 10) / 10;

  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rssMB: mb(usage.rss),
    heapUsedMB: mb(usage.heapUsed),
    heapTotalMB: mb(usage.heapTotal),
    externalMB: mb(usage.external),
  };
}

export function logMemory(label: string) {
  console.info("[memory] " + label, memorySnapshot());
}
