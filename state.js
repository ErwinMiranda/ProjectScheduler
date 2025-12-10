// state.js — Shared application state

// All task objects live here
export let tasks = [];

// Timeline scale (pixels per day)
export let scale = 36;

/**
 * Updates shared task list
 * Other modules import tasks directly
 */
export function updateTaskList(newTasks) {
    tasks = newTasks;
}
