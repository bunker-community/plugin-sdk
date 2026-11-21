// Optional: test from your own computer instead of uploading.
// BUNKER_TOKEN=<token> node local.js   (token: Settings -> Developer, shown once when the plugin is created)
import { connect } from "@bunker-community/plugin-sdk";
import plugin from "./plugin.js";

connect(plugin, { token: process.env.BUNKER_TOKEN });
