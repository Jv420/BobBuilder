require("dotenv").config();

const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const axios = require("axios");
const fs = require("fs");

const CONFIG_FILE = "./bobbuilder-data.json";

const BOT_HOST = process.env.BOT_HOST || "localhost";
const BOT_PORT = parseInt(process.env.BOT_PORT || "25565", 10);
const BOT_USERNAME = process.env.BOT_USERNAME || "BobBuilder";
const MC_VERSION = process.env.MC_VERSION || "1.21.11";
const OWNER_NAME = process.env.OWNER_NAME || "JouwMinecraftNaam";
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || "10000", 10);

const BUILD_TYPES = {
  house: "starterhouse",
  farm: "farm",
  storage: "storage",
  shop: "shop",
  spawn: "spawn",
  castle: "castle"
};

let bot;
let mcData;
let followTarget = null;
let reconnecting = false;
let builderWaypoint = null;

function loadData() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      builderWaypoint = data.builderWaypoint || null;
    }
  } catch (err) {
    console.log("Kon data niet laden:", err.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ builderWaypoint }, null, 2));
  } catch (err) {
    console.log("Kon data niet opslaan:", err.message);
  }
}

async function webhook(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      content: `🤖 **BobBuilder** | ${message}`
    });
  } catch {}
}

function isOwner(username) {
  return username.toLowerCase() === OWNER_NAME.toLowerCase();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBot() {
  loadData();

  bot = mineflayer.createBot({
    host: BOT_HOST,
    port: BOT_PORT,
    username: BOT_USERNAME,
    version: MC_VERSION
  });

  bot.loadPlugin(pathfinder);

  bot.once("spawn", () => {
    mcData = require("minecraft-data")(bot.version);

    const movements = new Movements(bot, mcData);
    movements.canDig = false;
    movements.allow1by1towers = true;
    bot.pathfinder.setMovements(movements);

    console.log("BobBuilder online");
    bot.chat("✅ BobBuilder online! Typ !help voor commands.");
    webhook("Online gekomen op DynathiSMP");

    setInterval(() => {
      if (!followTarget) return;
      const player = bot.players[followTarget]?.entity;
      if (!player) return;
      bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true);
    }, 2000);
  });

  bot.on("chat", async (username, message) => {
    if (username === bot.username) return;
    if (!isOwner(username)) return;

    try {
      await handleCommand(username, message.trim());
    } catch (err) {
      console.log(err);
      bot.chat(`❌ Fout: ${err.message}`);
      webhook(`❌ Fout: ${err.message}`);
    }
  });

  bot.on("kicked", reason => {
    console.log("Kicked:", reason);
    webhook(`Gekickt: ${JSON.stringify(reason)}`);
  });

  bot.on("error", err => {
    console.log("Bot error:", err.message);
  });

  bot.on("end", () => {
    console.log("BobBuilder offline");
    webhook("Offline / verbinding verloren");

    if (reconnecting) return;
    reconnecting = true;

    setTimeout(() => {
      reconnecting = false;
      createBot();
    }, RECONNECT_DELAY);
  });
}

async function handleCommand(username, message) {
  const args = message.split(/\s+/);
  const command = args[0].toLowerCase();
  const buildType = args[1]?.toLowerCase();

  if (command === "!help") {
    bot.chat("Commands: !follow, !stop, !setbuilder <house|farm|storage|shop|spawn|castle>, !builder, !build <type>, !status");
    return;
  }

  if (command === "!setbuilder") {
    await setBuilderWaypoint(username);

    if (buildType) {
      const schem = BUILD_TYPES[buildType];
      if (!schem) {
        bot.chat("❌ Onbekend type. Kies: house, farm, storage, shop, spawn, castle");
        return;
      }
      await pasteSchematic(schem, buildType);
    } else {
      bot.chat("Tip: gebruik !setbuilder house, !setbuilder farm, !setbuilder storage, !setbuilder shop, !setbuilder spawn of !setbuilder castle");
    }
    return;
  }

  if (command === "!builder") {
    await gotoBuilderWaypoint();
    return;
  }

  if (command === "!build") {
    const schem = BUILD_TYPES[buildType];
    if (!schem) {
      bot.chat("❌ Gebruik: !build house/farm/storage/shop/spawn/castle");
      return;
    }
    await pasteSchematic(schem, buildType);
    return;
  }

  if (command === "!follow") {
    followTarget = username;
    bot.chat(`👣 Ik volg ${username}`);
    webhook(`Volgt nu ${username}`);
    return;
  }

  if (command === "!stop") {
    followTarget = null;
    bot.pathfinder.setGoal(null);
    bot.chat("🛑 Gestopt.");
    webhook("Gestopt");
    return;
  }

  if (command === "!status") {
    const p = bot.entity.position;
    const wp = builderWaypoint ? `${builderWaypoint.x} ${builderWaypoint.y} ${builderWaypoint.z}` : "geen";
    bot.chat(`📍 Positie: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)} | waypoint: ${wp}`);
    return;
  }

  if (command === "!house") return pasteSchematic("starterhouse", "house");
  if (command === "!farm") return pasteSchematic("farm", "farm");
  if (command === "!storage") return pasteSchematic("storage", "storage");
  if (command === "!shop") return pasteSchematic("shop", "shop");
  if (command === "!spawn") return pasteSchematic("spawn", "spawn");
  if (command === "!castle") return pasteSchematic("castle", "castle");
}

async function setBuilderWaypoint(username) {
  const player = bot.players[username]?.entity;
  if (!player) {
    bot.chat("❌ Ik zie je niet.");
    return false;
  }

  builderWaypoint = {
    x: Math.floor(player.position.x),
    y: Math.floor(player.position.y),
    z: Math.floor(player.position.z)
  };

  saveData();
  bot.chat(`✅ Builder waypoint opgeslagen: ${builderWaypoint.x} ${builderWaypoint.y} ${builderWaypoint.z}`);
  webhook(`Builder waypoint opgeslagen: ${builderWaypoint.x} ${builderWaypoint.y} ${builderWaypoint.z}`);
  return true;
}

async function gotoBuilderWaypoint() {
  if (!builderWaypoint) {
    bot.chat("❌ Geen builder waypoint. Gebruik eerst !setbuilder.");
    return false;
  }

  followTarget = null;
  bot.chat("🏗️ Naar builder waypoint...");
  bot.pathfinder.setGoal(new goals.GoalBlock(builderWaypoint.x, builderWaypoint.y, builderWaypoint.z));

  await wait(3000);
  return true;
}

async function pasteSchematic(schematicName, displayName = schematicName) {
  if (!builderWaypoint) {
    bot.chat("❌ Eerst !setbuilder gebruiken.");
    return;
  }

  bot.chat(`🏗️ ${displayName} bouwen op builder waypoint...`);
  webhook(`Start bouwen: ${displayName}`);

  await gotoBuilderWaypoint();
  await wait(1500);

  // Gebruik 1 slash, want dit werkte op jouw server.
  bot.chat(`/schem load ${schematicName}`);
  await wait(2500);
  bot.chat(`/paste -a`);
  await wait(1500);

  bot.chat(`✅ ${displayName} command uitgevoerd op waypoint.`);
  webhook(`✅ Gebouwd: ${displayName}`);
}

createBot();
