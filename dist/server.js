// node_modules/@opencode-ai/plugin/dist/promise/plugin.js
function define(plugin2) {
  return plugin2;
}

// src/server.ts
async function setup(context) {
  await context.command.transform((commands) => {
    commands.update("usage", (command) => {
      command.description = "Usage Stat: open the local usage dashboard menu (current session & date ranges)";
    });
    commands.update("session-usage", (command) => {
      command.description = "Usage Stat: generate the current session's HTML usage report locally";
    });
    commands.update("total-usage", (command) => {
      command.description = "Usage Stat: generate a cumulative HTML usage report locally (optionally /total-usage 7 for last 7 days)";
    });
  });
}
var plugin = define({
  id: "opencode-usage-stat",
  tui: true,
  setup
});
var server_default = plugin;
export {
  server_default as default,
  setup
};
