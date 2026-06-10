require("dotenv").config();

const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;
const axios = require("axios");
const fs = require("fs");

const DATA_FILE = "./data.json";

const BOT_HOST = process.env.BOT_HOST || "localhost";
const BOT_PORT = parseInt(process.env.BOT_PORT || "25565", 10);
const BOT_USERNAME = process.env.BOT_USERNAME || "BobBuilder";
const MC_VERSION = process.env.MC_VERSION || "1.21.11";
const OWNER_NAME = process.env.OWNER_NAME || "JouwMinecraftNaam";
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || "10000", 10);
const AUTO_FOLLOW = String(process.env.AUTO_FOLLOW || "true").toLowerCase() === "true";
const FOLLOW_DISTANCE = parseInt(process.env.FOLLOW_DISTANCE || "2", 10);

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
let reconnecting = false;
let followTarget = AUTO_FOLLOW ? OWNER_NAME : null;
let isBuilding = false;

let data = {
  builderWaypoint: null,
  warehouseWaypoint: null
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = { ...data, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) };
    }
  } catch (err) {
    console.log("Kon data niet laden:", err.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log("Kon data niet opslaan:", err.message);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function webhook(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      content: `🤖 **BobBuilder V2** | ${message}`
    });
  } catch {}
}

function isOwner(username) {
  return username.toLowerCase() === OWNER_NAME.toLowerCase();
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
  bot.loadPlugin(collectBlock);

  bot.once("spawn", () => {
    mcData = require("minecraft-data")(bot.version);

    const movements = new Movements(bot, mcData);
    movements.canDig = false;
    movements.allow1by1towers = true;
    bot.pathfinder.setMovements(movements);

    bot.chat("✅ BobBuilder V2 online! Typ !help voor commands.");
    webhook("Online gekomen");

    if (AUTO_FOLLOW) {
      followTarget = OWNER_NAME;
      bot.chat(`👣 Auto-follow actief: ik volg ${OWNER_NAME}`);
    }

    setInterval(() => {
      if (isBuilding) return;
      if (!followTarget) return;

      const player = bot.players[followTarget]?.entity;
      if (!player) return;

      bot.pathfinder.setGoal(new goals.GoalFollow(player, FOLLOW_DISTANCE), true);
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
    webhook("Offline / verbinding verloren");

    if (reconnecting) return;
    reconnecting = true;

    setTimeout(() => {
      reconnecting = false;
      followTarget = AUTO_FOLLOW ? OWNER_NAME : null;
      isBuilding = false;
      createBot();
    }, RECONNECT_DELAY);
  });
}

async function handleCommand(username, message) {
  const args = message.split(/\s+/);
  const command = args[0].toLowerCase();
  const type = args[1]?.toLowerCase();

  if (command === "!help") {
    bot.chat("Commands: !follow, !stop, !setbuilder <type>, !build <type>, !setwarehouse, !warehouse, !farmtree, !farmcrop, !status");
    return;
  }

  if (command === "!follow") {
    followTarget = username;
    isBuilding = false;
    bot.chat(`👣 Ik volg ${username}`);
    webhook(`Volgt ${username}`);
    return;
  }

  if (command === "!stop") {
    followTarget = null;
    isBuilding = false;
    bot.pathfinder.setGoal(null);
    bot.chat("🛑 Gestopt.");
    webhook("Gestopt");
    return;
  }

  if (command === "!setbuilder") {
    await setWaypoint(username, "builderWaypoint", "Builder waypoint");

    if (type) {
      const schematic = BUILD_TYPES[type];
      if (!schematic) {
        bot.chat("❌ Kies: house, farm, storage, shop, spawn, castle");
        return;
      }
      await buildAtWaypoint(schematic, type, true);
    } else {
      bot.chat("Tip: !setbuilder house/farm/storage/shop/spawn/castle");
    }
    return;
  }

  if (command === "!build") {
    const schematic = BUILD_TYPES[type];
    if (!schematic) {
      bot.chat("❌ Gebruik: !build house/farm/storage/shop/spawn/castle");
      return;
    }
    await buildAtWaypoint(schematic, type, true);
    return;
  }

  if (command === "!setwarehouse") {
    await setWaypoint(username, "warehouseWaypoint", "Warehouse waypoint");
    return;
  }

  if (command === "!warehouse") {
    await gotoWaypoint("warehouseWaypoint", "warehouse");
    return;
  }

  if (command === "!farmtree") {
    await farmTrees();
    return;
  }

  if (command === "!farmcrop") {
    await farmCrops();
    return;
  }

  if (command === "!status") {
    const p = bot.entity.position;
    const b = data.builderWaypoint ? `${data.builderWaypoint.x} ${data.builderWaypoint.y} ${data.builderWaypoint.z}` : "geen";
    const w = data.warehouseWaypoint ? `${data.warehouseWaypoint.x} ${data.warehouseWaypoint.y} ${data.warehouseWaypoint.z}` : "geen";
    bot.chat(`📍 ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)} | builder: ${b} | warehouse: ${w} | follow: ${followTarget || "uit"}`);
    return;
  }

  if (command === "!house") return buildAtWaypoint("starterhouse", "house", true);
  if (command === "!farm") return buildAtWaypoint("farm", "farm", true);
  if (command === "!storage") return buildAtWaypoint("storage", "storage", true);
  if (command === "!shop") return buildAtWaypoint("shop", "shop", true);
  if (command === "!spawn") return buildAtWaypoint("spawn", "spawn", true);
  if (command === "!castle") return buildAtWaypoint("castle", "castle", true);
}

async function setWaypoint(username, key, label) {
  const player = bot.players[username]?.entity;
  if (!player) {
    bot.chat("❌ Ik zie je niet.");
    return false;
  }

  data[key] = {
    x: Math.floor(player.position.x),
    y: Math.floor(player.position.y),
    z: Math.floor(player.position.z)
  };

  saveData();
  bot.chat(`✅ ${label} opgeslagen: ${data[key].x} ${data[key].y} ${data[key].z}`);
  webhook(`${label} opgeslagen: ${data[key].x} ${data[key].y} ${data[key].z}`);
  return true;
}

async function gotoWaypoint(key, label) {
  const wp = data[key];
  if (!wp) {
    bot.chat(`❌ Geen ${label} waypoint gezet.`);
    return false;
  }

  bot.pathfinder.setGoal(new goals.GoalBlock(wp.x, wp.y, wp.z));
  bot.chat(`🚶 Naar ${label}: ${wp.x} ${wp.y} ${wp.z}`);
  await wait(3500);
  return true;
}

async function buildAtWaypoint(schematic, displayName, returnToFollow = true) {
  if (!data.builderWaypoint) {
    bot.chat("❌ Eerst !setbuilder gebruiken.");
    return;
  }

  isBuilding = true;
  followTarget = null;

  bot.chat(`🏗️ ${displayName} bouwen op builder waypoint...`);
  webhook(`Start bouwen: ${displayName}`);

  await gotoWaypoint("builderWaypoint", "builder");
  await wait(1500);

  bot.chat(`/schem load ${schematic}`);
  await wait(2500);
  bot.chat(`/paste -a`);
  await wait(2000);

  bot.chat(`✅ ${displayName} gebouwd op waypoint.`);
  webhook(`✅ Gebouwd: ${displayName}`);

  if (data.warehouseWaypoint) {
    await gotoWaypoint("warehouseWaypoint", "warehouse");
  }

  isBuilding = false;

  if (returnToFollow && AUTO_FOLLOW) {
    followTarget = OWNER_NAME;
    bot.chat(`👣 Klaar, ik volg ${OWNER_NAME} weer.`);
  }
}

async function farmTrees() {
  isBuilding = true;
  followTarget = null;

  bot.chat("🌲 Ik zoek logs om te verzamelen...");
  webhook("Farmtree gestart");

  const blocks = bot.findBlocks({
    matching: block => block.name.includes("log"),
    maxDistance: 64,
    count: 24
  });

  if (!blocks.length) {
    bot.chat("❌ Geen bomen/logs gevonden.");
    isBuilding = false;
    if (AUTO_FOLLOW) followTarget = OWNER_NAME;
    return;
  }

  const targets = blocks.map(pos => bot.blockAt(pos)).filter(Boolean);
  await bot.collectBlock.collect(targets);

  bot.chat("✅ Hout verzameld.");
  webhook("Hout verzameld");

  if (data.warehouseWaypoint) await gotoWaypoint("warehouseWaypoint", "warehouse");

  isBuilding = false;
  if (AUTO_FOLLOW) followTarget = OWNER_NAME;
}

async function farmCrops() {
  isBuilding = true;
  followTarget = null;

  bot.chat("🌾 Ik zoek volgroeide wheat/carrots/potatoes...");
  webhook("Farmcrop gestart");

  const cropNames = ["wheat", "carrots", "potatoes"];
  const crops = bot.findBlocks({
    matching: block => cropNames.includes(block.name) && block.metadata >= 7,
    maxDistance: 64,
    count: 32
  });

  if (!crops.length) {
    bot.chat("❌ Geen volgroeide crops gevonden.");
    isBuilding = false;
    if (AUTO_FOLLOW) followTarget = OWNER_NAME;
    return;
  }

  for (const pos of crops) {
    const block = bot.blockAt(pos);
    if (!block) continue;
    try {
      await bot.dig(block);
      await wait(250);
    } catch {}
  }

  bot.chat("✅ Crops geoogst. Herplanten maken we in V2.1.");
  webhook("Crops geoogst");

  if (data.warehouseWaypoint) await gotoWaypoint("warehouseWaypoint", "warehouse");

  isBuilding = false;
  if (AUTO_FOLLOW) followTarget = OWNER_NAME;
}

createBot();
