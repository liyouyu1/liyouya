const http = require("http");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "http://127.0.0.1",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const SAY_LINES = {
  click: ["冰冰凉凉。", "摸到了。", "今天也很圆。"],
  active: ["出发。", "换个地方待着。", "小跳一下。"],
  quiet: ["嗯。", "安静待机。", "呼噜。"],
  petChanged: ["登场。", "换糕成功。"],
  dragEnd: ["位置不错。", "落地。"]
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 128 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

class AgentServer {
  constructor({ getState, onAction }) {
    this.getState = getState;
    this.onAction = onAction;
    this.server = null;
    this.port = null;
  }

  async start() {
    if (this.server) {
      return this.port;
    }

    this.server = http.createServer((req, res) => {
      this.route(req, res).catch(error => {
        sendJson(res, 500, {
          ok: false,
          error: error.message || "Agent server error."
        });
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        this.server.off("error", reject);
        resolve();
      });
    });

    return this.port;
  }

  async stop() {
    if (!this.server) {
      return;
    }

    await new Promise(resolve => this.server.close(resolve));
    this.server = null;
    this.port = null;
  }

  async route(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      sendJson(res, 200, {
        ok: true,
        service: "catcake-agent",
        version: "0.1.0",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/v1/state") {
      sendJson(res, 200, {
        ok: true,
        state: this.getState()
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/events") {
      const event = await readJsonBody(req);
      const action = this.handlePetEvent(event);
      sendJson(res, 200, {
        ok: true,
        action
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/say") {
      const body = await readJsonBody(req);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const action = {
        emotion: "happy",
        motion: "bounce",
        say: text || "我在。"
      };
      this.emitAction(action);
      sendJson(res, 200, {
        ok: true,
        action
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: "Not found."
    });
  }

  handlePetEvent(event = {}, options = {}) {
    const state = this.getState();
    const type = event.type || "idleTick";
    const shouldEmit = options.emit !== false;
    let action;

    if (type === "click") {
      action = {
        emotion: "happy",
        motion: state.mode === "active" ? "bounce" : "squish",
        say: pick(SAY_LINES.click)
      };
    } else if (type === "dragEnd") {
      action = {
        emotion: "curious",
        motion: "shake",
        say: pick(SAY_LINES.dragEnd)
      };
    } else if (type === "modeChanged") {
      action = {
        emotion: state.mode === "active" ? "happy" : "sleepy",
        motion: "bounce",
        say: state.mode === "active" ? pick(SAY_LINES.active) : pick(SAY_LINES.quiet)
      };
    } else if (type === "petChanged") {
      action = {
        emotion: "happy",
        motion: "bounce",
        say: `${state.currentPet.name}${pick(SAY_LINES.petChanged)}`
      };
    } else if (state.mode === "active") {
      action = {
        emotion: Math.random() > 0.5 ? "happy" : "curious",
        motion: Math.random() > 0.35 ? "hop" : "bounce",
        say: Math.random() > 0.55 ? pick(SAY_LINES.active) : ""
      };
    } else {
      action = {
        emotion: Math.random() > 0.65 ? "sleepy" : "idle",
        motion: Math.random() > 0.7 ? "sleep" : "idle",
        say: Math.random() > 0.82 ? pick(SAY_LINES.quiet) : ""
      };
    }

    if (shouldEmit) {
      this.emitAction(action);
    }

    return action;
  }

  emitAction(action) {
    if (typeof this.onAction === "function") {
      this.onAction(action);
    }
  }
}

module.exports = {
  AgentServer
};
