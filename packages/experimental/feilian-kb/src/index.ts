// @ts-nocheck
/**
 * 飞链知识库 — DeepSeek Harness host half.
 *
 * The plugin logs in once with the tenant account. The platform mints a
 * read-only, revocable kb_ credential bound to the member's readable
 * knowledge bases; this process stores it in the DSH credential store and
 * never returns it to the browser UI.
 */

export const name = "feilian-kb";
export const inject = ["connection", "credentials"];

const FEILIAN_BASE = "https://flylink.yituobo.com";
const CREDENTIAL_KEY = "feilian-kb/session";
const DEVICE_NAME = "DeepSeek Harness";
const PLUGIN_VERSION = "0.2.7";
// Built in: the plugin ships and upgrades with the application, so the
// standalone tarball update prompt is disabled.
const BUILTIN = true;
const UPDATE_MANIFEST_URL = `${FEILIAN_BASE}/downloads/dsh/manifest.json`;
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;
let updateCache = { at: 0, value: null };

function versionValue(value) {
  const text = String(value || "").trim().replace(/^v/iu, "");
  const [core] = text.split("-", 1);
  return core.split(".").map((part) => {
    const number = Number.parseInt(part, 10);
    return Number.isFinite(number) ? number : 0;
  });
}

function compareVersions(left, right) {
  const a = versionValue(left);
  const b = versionValue(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

async function checkPluginUpdate() {
  // Built in: upgrades ship with the application, so never offer the standalone tarball.
  if (BUILTIN) return null;
  if (updateCache.value && Date.now() - updateCache.at < UPDATE_CACHE_MS) {
    return updateCache.value;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(UPDATE_MANIFEST_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    const latest = String(manifest?.version || "").trim();
    if (!latest) throw new Error("manifest version missing");
    const value = {
      current: PLUGIN_VERSION,
      latest,
      tarball: String(manifest?.tarball || ""),
      sha256: String(manifest?.sha256 || ""),
      update_available: compareVersions(latest, PLUGIN_VERSION) > 0,
    };
    updateCache = { at: Date.now(), value };
    return value;
  } catch {
    return updateCache.value;
  } finally {
    clearTimeout(timer);
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function detailOf(body, fallback) {
  if (body && typeof body === "object") {
    if (typeof body.detail === "string" && body.detail) return body.detail;
    if (body.detail && typeof body.detail === "object") {
      if (typeof body.detail.message === "string" && body.detail.message) {
        return body.detail.message;
      }
      if (typeof body.detail.code === "string" && body.detail.code) {
        return body.detail.code;
      }
    }
    if (typeof body.error === "string" && body.error) return body.error;
  }
  return fallback;
}

async function readSession(ctx) {
  try {
    const record = await ctx.credentials.readRecord(CREDENTIAL_KEY);
    const payload = record && record.payload;
    return payload && payload.token ? payload : null;
  } catch {
    return null;
  }
}

async function writeSession(ctx, value) {
  await ctx.credentials.modifyRecord(CREDENTIAL_KEY, async () => ({
    kind: "grant",
    payload: value,
  }));
}

async function clearSession(ctx) {
  try {
    await ctx.credentials.deleteRecord(CREDENTIAL_KEY);
  } catch {
    // Already signed out.
  }
}

async function feilianFetch(token, path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${FEILIAN_BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function compactKnowledgeBases(items) {
  return (Array.isArray(items) ? items : []).map((kb) => ({
    id: kb.id,
    name: kb.name,
    status: kb.status,
    openkb_status: kb.openkb_status,
  }));
}

async function currentState(ctx) {
  const [update, session] = await Promise.all([checkPluginUpdate(), readSession(ctx)]);
  const updateField = update ? { update } : {};
  if (!session) return { signed_in: false, ...updateField };
  const result = await feilianFetch(session.token, "/api/v1/external/capabilities");
  if (result.status === 401) {
    await clearSession(ctx);
    return { signed_in: false, ...updateField };
  }
  if (result.status !== 200) {
    return {
      signed_in: true,
      user: session.user,
      tenant: session.tenant,
      knowledge_bases: compactKnowledgeBases(session.knowledge_bases),
      warning: detailOf(result.body, "无法刷新知识库列表"),
      ...updateField,
    };
  }
  return {
    signed_in: true,
    user: session.user,
    tenant: session.tenant,
    knowledge_bases: compactKnowledgeBases(result.body?.knowledge_bases),
    ...updateField,
  };
}

function memberTokenOf(session) {
  // Device tokens resolve to the member on the API, so connector/graph routes
  // use the same credential when no separate member token exists.
  return session?.member_token || session?.token || "";
}

function registerRoute(ctx, path, methods, handler) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path,
        methods,
        requestBody: "buffered",
        fetch: handler,
      }),
    `feilian-kb: ${path}`,
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function apply(ctx) {
  registerRoute(ctx, "/api/feilian-kb/state", ["GET"], async () =>
    jsonResponse(200, await currentState(ctx)),
  );

  registerRoute(ctx, "/api/feilian-kb/options", ["POST"], async (request) => {
    const payload = await readJson(request);
    const email = String(payload?.email || "").trim();
    const password = String(payload?.password || "");
    if (!email || !password) return jsonResponse(400, { error: "请输入账号和密码" });
    const result = await feilianFetch(null, "/api/v1/auth/login-options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取企业列表"),
      });
    }
    return jsonResponse(200, { tenants: Array.isArray(result.body) ? result.body : [] });
  });

  registerRoute(ctx, "/api/feilian-kb/device/start", ["POST"], async (request) => {
    const payload = (await readJson(request)) || {};
    const result = await feilianFetch(null, "/api/v1/oauth/device/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "dsh-feilian-kb",
        device_name: String(payload.device_name || DEVICE_NAME).slice(0, 120),
        platform: "dsh",
      }),
    });
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法发起浏览器授权"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/device/poll", ["POST"], async (request) => {
    const payload = (await readJson(request)) || {};
    const deviceCode = String(payload.device_code || "").trim();
    if (!deviceCode) return jsonResponse(400, { error: "缺少 device_code" });
    const result = await feilianFetch(null, "/api/v1/oauth/device/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
    if (result.status === 400) {
      const detail = result.body && typeof result.body === "object" ? result.body.detail : null;
      const code = detail && typeof detail === "object" ? String(detail.error || "") : "";
      if (code === "authorization_pending") {
        return jsonResponse(200, { status: "pending" });
      }
      return jsonResponse(400, {
        error: (detail && typeof detail === "object" && detail.message) || detailOf(result.body, "授权失败"),
        code,
      });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "授权失败"),
      });
    }
    const body = result.body || {};
    const token = String(body.access_token || "");
    if (!token) return jsonResponse(502, { error: "授权成功但没有返回设备 token" });
    const capabilities = await feilianFetch(token, "/api/v1/external/capabilities");
    if (capabilities.status !== 200) {
      return jsonResponse(capabilities.status === 401 ? 401 : 502, {
        error: detailOf(capabilities.body, "无法读取知识库列表"),
      });
    }
    const session = {
      token,
      tenant: body.tenant,
      user: body.user,
      knowledge_bases: capabilities.body?.knowledge_bases || [],
      device_id: body.device_id || "",
      signed_in_at: new Date().toISOString(),
    };
    await writeSession(ctx, session);
    const update = await checkPluginUpdate();
    return jsonResponse(200, {
      signed_in: true,
      ...session,
      ...(update ? { update } : {}),
    });
  });

  registerRoute(ctx, "/api/feilian-kb/login", ["POST"], async (request) => {
    const payload = await readJson(request);
    const email = String(payload?.email || "").trim();
    const password = String(payload?.password || "");
    const tenantId = payload?.tenant_id ? String(payload.tenant_id) : undefined;
    if (!email || !password) return jsonResponse(400, { error: "请输入账号和密码" });
    const result = await feilianFetch(null, "/api/v1/plugin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        device_name: DEVICE_NAME,
      }),
    });
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "登录失败"),
      });
    }
    const body = result.body || {};
    await writeSession(ctx, {
      token: body.token,
      member_token: body.member_token || "",
      tenant: body.tenant,
      user: body.user,
      knowledge_bases: body.knowledge_bases || [],
      signed_in_at: new Date().toISOString(),
    });
    const update = await checkPluginUpdate();
    return jsonResponse(200, {
      signed_in: true,
      user: body.user,
      tenant: body.tenant,
      knowledge_bases: compactKnowledgeBases(body.knowledge_bases),
      ...(update ? { update } : {}),
    });
  });

  registerRoute(ctx, "/api/feilian-kb/logout", ["POST"], async () => {
    const session = await readSession(ctx);
    if (session?.token) {
      try {
        const revokePath = String(session.token).startsWith("fld_")
          ? "/api/v1/oauth/device/revoke"
          : "/api/v1/plugin/auth/revoke";
        await feilianFetch(session.token, revokePath, {
          method: "POST",
        });
      } catch {
        // Local sign-out still proceeds if the platform is unreachable.
      }
    }
    await clearSession(ctx);
    return jsonResponse(200, { signed_in: false });
  });

  registerRoute(ctx, "/api/feilian-kb/list", ["GET"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const url = new URL(request.url);
    const kbId = url.searchParams.get("kb_id");
    if (!kbId) return jsonResponse(400, { error: "缺少 kb_id" });
    const compact = url.searchParams.get("compact") === "1" ? "&compact=true" : "";
    const result = await feilianFetch(
      session.token,
      `/api/v1/openkb/list?tenant_id=${encodeURIComponent(session.tenant.id)}&knowledge_base_id=${encodeURIComponent(kbId)}${compact}`,
    );
    if (result.status === 401) {
      await clearSession(ctx);
      return jsonResponse(401, { error: "登录已失效，请重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取知识库目录"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/page", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const payload = await readJson(request);
    const kbId = String(payload?.kb_id || "");
    const path = String(payload?.path || "");
    if (!kbId || !path) return jsonResponse(400, { error: "缺少知识库或页面路径" });
    const result = await feilianFetch(session.token, "/api/v1/openkb/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: session.tenant.id,
        knowledge_base_id: kbId,
        path,
      }),
    });
    if (result.status === 401) {
      await clearSession(ctx);
      return jsonResponse(401, { error: "登录已失效，请重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取页面"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/source", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const payload = await readJson(request);
    const versionId = String(payload?.version_id || "");
    if (!versionId) return jsonResponse(400, { error: "缺少来源版本" });
    const result = await feilianFetch(
      session.token,
      `/api/v1/source-versions/${encodeURIComponent(versionId)}/preview`,
    );
    if (result.status === 401) {
      await clearSession(ctx);
      return jsonResponse(401, { error: "登录已失效，请重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取来源预览"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/query", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const payload = await readJson(request);
    const kbId = String(payload?.kb_id || "");
    const question = String(payload?.question || "").trim();
    if (!kbId || !question) return jsonResponse(400, { error: "请选择知识库并输入问题" });
    const result = await feilianFetch(session.token, "/api/v1/external/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ knowledge_base_id: kbId, question }),
    });
    if (result.status === 401) {
      await clearSession(ctx);
      return jsonResponse(401, { error: "登录已失效，请重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "问答失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/sources", ["GET"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const url = new URL(request.url);
    const kbId = url.searchParams.get("kb_id");
    if (!kbId) return jsonResponse(400, { error: "缺少 kb_id" });
    const result = await feilianFetch(
      session.token,
      `/api/v1/sources?tenant_id=${encodeURIComponent(session.tenant.id)}&knowledge_base_id=${encodeURIComponent(kbId)}`,
    );
    if (result.status === 401) {
      await clearSession(ctx);
      return jsonResponse(401, { error: "登录已失效，请重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取来源目录"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/graph", ["GET"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const url = new URL(request.url);
    const kbId = url.searchParams.get("kb_id");
    if (!kbId) return jsonResponse(400, { error: "缺少 kb_id" });
    const result = await feilianFetch(
      memberToken,
      `/api/v1/openkb/graph?tenant_id=${encodeURIComponent(session.tenant.id)}&knowledge_base_id=${encodeURIComponent(kbId)}`,
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取知识图谱"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/connectors", ["GET"], async () => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const result = await feilianFetch(
      memberToken,
      `/api/v1/connectors?tenant_id=${encodeURIComponent(session.tenant.id)}`,
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "无法读取飞书机器人"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/connectors/save", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = await readJson(request);
    const connectorId = String(payload?.id || "");
    const platform = ["feishu", "lark", "dingtalk", "wecom", "weixin", "telegram"].includes(String(payload?.platform))
      ? String(payload.platform)
      : "feishu";
    const name = String(payload?.name || "").trim();
    const appId = String(payload?.app_id || "").trim();
    const appSecret = String(payload?.app_secret || "");
    const robotCode = String(payload?.robot_code || "").trim();
    const signingSecret = String(payload?.signing_secret || "");
    const webhookUrl = String(payload?.notification_webhook_url || "").trim();
    const knowledgeBaseIds = Array.isArray(payload?.knowledge_base_ids)
      ? payload.knowledge_base_ids.filter(Boolean)
      : [];
    const systemPrompt = String(payload?.system_prompt || "");
    const writeEnabled = Boolean(payload?.write_enabled);
    const showSources = payload?.show_sources === undefined ? true : Boolean(payload.show_sources);
    if (!name) return jsonResponse(400, { error: "请填写机器人名称" });

    if (connectorId) {
      const body = { name };
      if (platform === "wecom") {
        if (webhookUrl) body.notification_webhook_url = webhookUrl;
      } else {
        if (knowledgeBaseIds.length) body.knowledge_base_ids = knowledgeBaseIds;
        body.system_prompt = systemPrompt;
        body.write_enabled = writeEnabled;
        body.show_sources = showSources;
        if (!["weixin", "telegram"].includes(platform)) {
          if (appId) body.app_id = appId;
          if (appSecret) body.app_secret = appSecret;
          if (platform === "dingtalk") {
            if (robotCode) body.robot_code = robotCode;
            if (signingSecret) body.signing_secret = signingSecret;
          }
        }
      }
      const result = await feilianFetch(
        memberToken,
        `/api/v1/connectors/${encodeURIComponent(connectorId)}?tenant_id=${encodeURIComponent(session.tenant.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (result.status === 401) {
        return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
      }
      if (result.status !== 200) {
        return jsonResponse(result.status, {
          error: detailOf(result.body, "保存机器人失败"),
        });
      }
      return jsonResponse(200, result.body);
    }

    if (platform === "wecom") {
      if (!webhookUrl) return jsonResponse(400, { error: "请填写群机器人 Webhook 地址" });
      const result = await feilianFetch(memberToken, "/api/v1/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: session.tenant.id,
          platform: "wecom",
          name,
          integration_type: "notification",
          connection_mode: "webhook",
          credential_mode: "notification_webhook",
          notification_webhook_url: webhookUrl,
          show_sources: false,
        }),
      });
      if (result.status === 401) {
        return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
      }
      if (result.status !== 201) {
        return jsonResponse(result.status, {
          error: detailOf(result.body, "创建企业微信机器人失败"),
        });
      }
      return jsonResponse(200, result.body);
    }

    if (platform === "weixin") {
      return jsonResponse(400, { error: "微信机器人请用「扫码绑定」，不需要 App ID" });
    }
    if (platform === "telegram") {
      return jsonResponse(400, { error: "Telegram 机器人请用「绑定 Telegram」，只需要 Bot Token" });
    }
    if (!knowledgeBaseIds.length) return jsonResponse(400, { error: "至少授权一个知识库" });
    if (!appId || !appSecret) return jsonResponse(400, { error: "请填写 App ID 和 App Secret" });
    if (platform === "dingtalk") {
      if (!robotCode) return jsonResponse(400, { error: "请填写 Robot Code" });
      if (!signingSecret) return jsonResponse(400, { error: "请填写事件签名/加密密钥" });
    }
    const result = await feilianFetch(memberToken, "/api/v1/connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: session.tenant.id,
        platform,
        name,
        knowledge_base_ids: knowledgeBaseIds,
        integration_type: "conversation",
        connection_mode: ["feishu", "lark"].includes(platform) ? "long_connection" : "webhook",
        credential_mode: "app",
        app_id: appId,
        app_secret: appSecret,
        system_prompt: systemPrompt,
        write_enabled: writeEnabled,
        show_sources: true,
        ...(platform === "dingtalk"
          ? { robot_code: robotCode, signing_secret: signingSecret }
          : {}),
      }),
    });
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 201) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, platform === "dingtalk" ? "创建钉钉机器人失败" : "创建飞书机器人失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/connectors/test", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = await readJson(request);
    const connectorId = String(payload?.id || "");
    if (!connectorId) return jsonResponse(400, { error: "缺少机器人 id" });
    const result = await feilianFetch(
      memberToken,
      `/api/v1/connectors/${encodeURIComponent(connectorId)}/test?tenant_id=${encodeURIComponent(session.tenant.id)}`,
      { method: "POST" },
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status === 200) {
      return jsonResponse(200, {
        ok: true,
        message: result.body?.message || "连接正常",
        status: result.body?.connection_status,
      });
    }
    return jsonResponse(200, {
      ok: false,
      error: detailOf(result.body, "连接失败"),
    });
  });

  registerRoute(ctx, "/api/feilian-kb/weixin/qr", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = (await readJson(request)) || {};
    const name = String(payload.name || "").trim();
    const knowledgeBaseIds = Array.isArray(payload.knowledge_base_ids)
      ? payload.knowledge_base_ids.filter(Boolean)
      : [];
    if (!name) return jsonResponse(400, { error: "请填写机器人名称" });
    if (!knowledgeBaseIds.length) return jsonResponse(400, { error: "至少授权一个知识库" });
    const result = await feilianFetch(memberToken, "/api/v1/plugin/weixin/qr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: session.tenant.id,
        ...(payload.id ? { connector_id: String(payload.id) } : {}),
        name,
        knowledge_base_ids: knowledgeBaseIds,
        system_prompt: String(payload.system_prompt || ""),
        write_enabled: Boolean(payload.write_enabled),
        show_sources: payload.show_sources === undefined ? true : Boolean(payload.show_sources),
      }),
    });
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "微信二维码生成失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/weixin/qr/status", ["GET"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const url = new URL(request.url);
    const qrcode = url.searchParams.get("qrcode") || "";
    if (!qrcode) return jsonResponse(400, { error: "缺少二维码参数" });
    const result = await feilianFetch(
      memberToken,
      `/api/v1/plugin/weixin/qr/status?tenant_id=${encodeURIComponent(session.tenant.id)}&qrcode=${encodeURIComponent(qrcode)}`,
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "扫码状态查询失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/weixin/unbind", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = await readJson(request);
    const connectorId = String(payload?.id || "");
    if (!connectorId) return jsonResponse(400, { error: "缺少机器人 id" });
    const result = await feilianFetch(
      memberToken,
      `/api/v1/plugin/weixin/${encodeURIComponent(connectorId)}/unbind?tenant_id=${encodeURIComponent(session.tenant.id)}`,
      { method: "POST" },
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "解除微信绑定失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/telegram/bind", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = (await readJson(request)) || {};
    const name = String(payload.name || "").trim();
    const token = String(payload.token || "").trim();
    const knowledgeBaseIds = Array.isArray(payload.knowledge_base_ids)
      ? payload.knowledge_base_ids.filter(Boolean)
      : [];
    if (!name) return jsonResponse(400, { error: "请填写机器人名称" });
    if (!token) return jsonResponse(400, { error: "请填写 Bot Token" });
    if (!knowledgeBaseIds.length) return jsonResponse(400, { error: "至少授权一个知识库" });
    const result = await feilianFetch(memberToken, "/api/v1/plugin/telegram/bind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: session.tenant.id,
        ...(payload.id ? { connector_id: String(payload.id) } : {}),
        name,
        token,
        knowledge_base_ids: knowledgeBaseIds,
        system_prompt: String(payload.system_prompt || ""),
        write_enabled: Boolean(payload.write_enabled),
        show_sources: payload.show_sources === undefined ? true : Boolean(payload.show_sources),
      }),
    });
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "Telegram 绑定失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  registerRoute(ctx, "/api/feilian-kb/telegram/unbind", ["POST"], async (request) => {
    const session = await readSession(ctx);
    if (!session) return jsonResponse(401, { error: "请先登录飞链知识库" });
    const memberToken = memberTokenOf(session);
    if (!memberToken) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    const payload = await readJson(request);
    const connectorId = String(payload?.id || "");
    if (!connectorId) return jsonResponse(400, { error: "缺少机器人 id" });
    const result = await feilianFetch(
      memberToken,
      `/api/v1/plugin/telegram/${encodeURIComponent(connectorId)}/unbind?tenant_id=${encodeURIComponent(session.tenant.id)}`,
      { method: "POST" },
    );
    if (result.status === 401) {
      return jsonResponse(401, { error: "登录已过期，请退出后重新登录" });
    }
    if (result.status !== 200) {
      return jsonResponse(result.status, {
        error: detailOf(result.body, "解除 Telegram 绑定失败"),
      });
    }
    return jsonResponse(200, result.body);
  });

  // Agent tools. They read the same credential and fail with a clear message
  // until the user signs in from the sidebar page.
  ctx.inject(["tools"], (toolsCtx) => {
    toolsCtx.effect(
      () =>
        toolsCtx.tools.register({
          name: "feilian_kb_search",
          description:
            "查询飞链企业知识库并返回带引用的回答。使用前需在侧边栏「飞链知识库」页面登录。",
          parameters: {
            question: { type: "string", required: true, description: "要查询的问题" },
            knowledge_base_id: {
              type: "string",
              required: false,
              description: "知识库 id；不传时使用当前登录账号的第一个知识库",
            },
          },
          output: {
            schema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                citations: { type: "array" },
                trace_id: { type: "string" },
              },
              required: ["answer"],
            },
            render: (_args, value) => [
              { type: "text", text: JSON.stringify(value) },
            ],
          },
          async execute(args) {
            const session = await readSession(ctx);
            if (!session) {
              return { answer: "请先在 DSH 侧边栏「飞链知识库」页面登录。" };
            }
            const kbId =
              args.knowledge_base_id || session.knowledge_bases?.[0]?.id;
            if (!kbId) return { answer: "当前账号没有可用的知识库。" };
            const result = await feilianFetch(session.token, "/api/v1/external/query", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ knowledge_base_id: kbId, question: String(args.question || "") }),
            });
            if (result.status !== 200) {
              return { answer: detailOf(result.body, "知识库查询失败") };
            }
            return {
              answer: result.body?.answer || "",
              citations: result.body?.citations || [],
              trace_id: result.body?.trace_id || "",
            };
          },
        }),
      "feilian-kb: search tool",
    );

    toolsCtx.effect(
      () =>
        toolsCtx.tools.register({
          name: "feilian_kb_page",
          description:
            "读取飞链知识库中的一个编译页面。使用前需在侧边栏「飞链知识库」页面登录。",
          parameters: {
            path: { type: "string", required: true, description: "页面路径，例如 index.md 或 summaries/xxx.md" },
            knowledge_base_id: {
              type: "string",
              required: false,
              description: "知识库 id；不传时使用当前登录账号的第一个知识库",
            },
          },
          output: {
            schema: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["content"],
            },
            render: (_args, value) => [
              { type: "text", text: String(value?.content || "") },
            ],
          },
          async execute(args) {
            const session = await readSession(ctx);
            if (!session) {
              return { content: "请先在 DSH 侧边栏「飞链知识库」页面登录。" };
            }
            const kbId =
              args.knowledge_base_id || session.knowledge_bases?.[0]?.id;
            if (!kbId) return { content: "当前账号没有可用的知识库。" };
            const result = await feilianFetch(session.token, "/api/v1/openkb/page", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                tenant_id: session.tenant.id,
                knowledge_base_id: kbId,
                path: String(args.path || ""),
              }),
            });
            if (result.status !== 200) {
              return { content: detailOf(result.body, "页面读取失败") };
            }
            return {
              path: result.body?.path || args.path,
              content: result.body?.content || "",
            };
          },
        }),
      "feilian-kb: page tool",
    );
  });
}