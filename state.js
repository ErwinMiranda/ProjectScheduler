// state.js — Central shared application state

export let tasks = [];
export const selectedBars = new Set();

export let scale = 36;

export function updateTaskList(newTasks) {
  tasks = newTasks;
}

export function setScale(newScale) {
  scale = newScale;
}

// Undo stack
export const historyStack = [];

export function pushHistory() {
  historyStack.push(JSON.stringify(tasks));
}

export function undoHistory() {
  if (historyStack.length === 0) return false;

  const snapshot = historyStack.pop();
  const restored = JSON.parse(snapshot);

  tasks.length = 0;
  restored.forEach((t) =>
    tasks.push({
      ...t,
      start: new Date(t.start),
      end: new Date(t.end),
    })
  );

  return true;
}
