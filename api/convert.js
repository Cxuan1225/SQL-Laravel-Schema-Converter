const { convertSql } = require("../src/converter");

const MAX_BODY_BYTES = 1024 * 1024;

module.exports = async function convertHandler(req, res) {
  setJsonHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end("");
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, {
      error: "Method not allowed",
      message: "Use POST /api/convert with a JSON body.",
    });
    return;
  }

  try {
    const body = await readJsonBody(req);

    if (!body || typeof body.sql !== "string") {
      sendJson(res, 400, {
        error: "Invalid request",
        message: "Request body must include a string `sql` field.",
      });
      return;
    }

    const result = convertSql(body.sql, body.options || {});
    sendJson(res, 200, result);
  } catch (error) {
    console.error("Failed to convert SQL", error);
    sendJson(res, error.statusCode || 500, {
      error: error.publicMessage || "Conversion failed",
    });
  }
};

function setJsonHeaders(res) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    return parseJson(req.body);
  }

  const contentLength = Number(req.headers && req.headers["content-length"]);
  if (contentLength > MAX_BODY_BYTES) {
    const error = new Error("Request body too large");
    error.statusCode = 413;
    error.publicMessage = "Request body exceeds the 1 MB limit.";
    throw error;
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      error.publicMessage = "Request body exceeds the 1 MB limit.";
      throw error;
    }
    chunks.push(chunk);
  }

  return parseJson(Buffer.concat(chunks).toString("utf8"));
}

function parseJson(input) {
  try {
    return JSON.parse(input || "{}");
  } catch (error) {
    error.statusCode = 400;
    error.publicMessage = "Request body must be valid JSON.";
    throw error;
  }
}
