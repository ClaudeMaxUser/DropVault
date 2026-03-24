import { useState, useCallback } from "react";
import { nowTime } from "../lib/format";

export function useLogs() {
  const [logs, setLogs] = useState([
    { t: nowTime(), m: "initializing...", k: "info" },
  ]);

  const addLog = useCallback((m, k = "info") => {
    setLogs((l) => [...l.slice(-99), { t: nowTime(), m, k }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, addLog, clearLogs };
}