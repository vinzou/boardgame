const WebSocket = require("ws");
const serveStatic = require("serve-static");
const fs = require("fs");

const inDocker = fs.existsSync("/.dockerenv");
let wsArgs = {};
// Inside Docker so run the whole game
if (inDocker) {
  wsArgs.noServer = true;
} else {
  wsArgs.port = 8081;
}

const wss = new WebSocket.Server(wsArgs);
const uuid = require("uuid");

const games = {};

if (inDocker) {
  const http = require("http");
  const serve = serveStatic("/public", { index: ["index.html"] });
  const server = http.createServer((req, res) => {
    serve(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  // Add WS
  server.on("upgrade", function upgrade(request, socket, head) {
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit("connection", ws, request);
    });
  });
  server.listen(80);
}

class Game {
  constructor() {
    this.players = [];
  }
  sendCommand(player, command, ...args) {
    player.send(`CMD:${command}:${JSON.stringify(args)}`);
  }

  broadcastCommand(ignore, command, ...args) {
    this.players.forEach((player) => {
      if (player === ignore) return;
      this.sendCommand(player, command, ...args);
    });
  }

  quit(player) {
    let idx = this.players.indexOf(player);
    if (idx < 0) {
      return;
    }
    this.players = this.players.splice(idx, 1);
    this.broadcastCommand(undefined, "quit", player.playerId);
  }

  join(player) {
    if (this.players.indexOf(player) >= 0) {
      return;
    }
    this.players.push(player);
    this.broadcastCommand(player, "join", player.playerId);
  }

  update(player, info) {
    this.broadcastCommand(player, "update", player.playerId, info);
  }

  message(player, msg) {
    this.broadcastCommand(player, "message", player.playerId, msg);
  }

  privateMessage(player, dest, msg) {
    player.send("WIP");
  }
}

console.log("WS started");
wss.on("connection", function connection(ws) {
  ws.playerId = uuid.v4();
  console.log("Connection of", ws.playerId);
  ws.on("message", function incoming(message) {
    console.log("Message of", ws.playerId, ":", message);
    if (message.startsWith("CMD:")) {
      let cmdInfo = /CMD:(?<cuuid>[^:]+):(?<gameId>[^:]+):(?<cmd>[^:]+):(?<args>.*)/g.exec(message);
      if (!cmdInfo) {
        ws.send("Invalid command syntax");
        return;
      }
      let { cmd, cuuid, gameId, args } = cmdInfo.groups;
      console.log(cmd, cuuid, gameId, args);
      if (cmd === "join") {
        if (!games[gameId]) {
          games[gameId] = new Game();
        }
      }
      if (!games[gameId]) {
        ws.send("ERROR:Invalid Game");
        return;
      }
      games[gameId][cmd](ws, ...JSON.parse(args || "[]"));
      ws.send("ACK:" + cuuid);
    } else {
      ws.send("Invalid command");
    }
  });
  ws.on("close", () => {
    if (ws.game) {
      ws.game.quit(ws);
    }
    console.log("Lost Connection of", ws.playerId);
  });
});
