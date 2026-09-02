const ADMIN_LOGIN_LOG_LIMIT = 200;

function requireAuthUser(req, res) {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ ok: false, error: "未登录" });
    return null;
  }
  return currentUser;
}

function hasElevatedRole(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function registerAdminAuthRoutes({
  app,
  logger: _logger,
  userStore,
  requireAdminToken,
  createAdminSession,
  updateAdminSessions,
  requireAdminRole,
}) {
  /* ---------------- 登录 ---------------- */
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    const ip = userStore.getClientIp(req);
    const userAgent = String((req.headers && req.headers["user-agent"]) || "");

    if (!username || !password) {
      return res
        .status(400)
        .json({ ok: false, error: "用户名和密码不能为空" });
    }

    if (userStore.checkLoginRateLimit(ip)) {
      return res
        .status(429)
        .json({ ok: false, error: "登录尝试过于频繁，请稍后再试", errorType: 'rate_limit', code: 'RATE_LIMIT' });
    }

    const user = userStore.findUser(username);
    if (!user) {
      userStore.recordLoginAttempt({
        username,
        success: false,
        ip,
        userAgent,
        reason: "用户不存在",
      });
      return res.status(401).json({ ok: false, error: "用户名或密码错误" });
    }

    if (
      !userStore.verifyPassword(
        password,
        user.passwordSalt,
        user.passwordHash,
      )
    ) {
      userStore.recordLoginAttempt({
        username,
        success: false,
        ip,
        userAgent,
        reason: "密码错误",
      });
      const lockout = userStore.checkAccountLockout(username);
      return res
        .status(401)
        .json({ ok: false, error: "用户名或密码错误", errorType: 'invalid_credentials', lockout });
    }

    const lockout = userStore.checkAccountLockout(username);
    if (lockout.locked) {
      userStore.recordLoginAttempt({
        username,
        success: false,
        ip,
        userAgent,
        reason: "账号锁定",
      });
      return res
        .status(403)
        .json({ ok: false, error: "账号已被锁定，请稍后再试", errorType: 'locked', lockout });
    }

    const elevated = hasElevatedRole(user);
    if (!elevated) {
      const card = user.cardCode
        ? userStore.getOneCardByCode(user.cardCode)
        : null;
      if (!card || card.enabled === false) {
        userStore.recordLoginAttempt({
          username,
          success: false,
          ip,
          userAgent,
          reason: "账号被封禁",
        });
        return res
          .status(403)
          .json({ ok: false, error: "账号已被封禁", code: "BANNED" });
      }
      if (card.expiresAt && new Date(card.expiresAt).getTime() < Date.now()) {
        userStore.recordLoginAttempt({
          username,
          success: false,
          ip,
          userAgent,
          reason: "账号过期",
        });
        return res
          .status(403)
          .json({ ok: false, error: "账号已过期，请续费", code: "EXPIRED" });
      }
    }

    userStore.recordLoginAttempt({
      username: user.username,
      success: true,
      ip,
      userAgent,
    });

    const userInfo = userStore.getUser(user.username);
    const token = createAdminSession(userInfo);
    return res.json({
      ok: true,
      data: {
        token,
        role: userInfo.role,
        card: userInfo.card,
        accountLimit: userInfo.accountLimit,
        mustChangePassword: userInfo.mustChangePassword === true,
        user: {
          username: userInfo.username,
          role: userInfo.role,
          card: userInfo.card,
          accountLimit: userInfo.accountLimit,
          mustChangePassword: userInfo.mustChangePassword === true,
        },
      },
    });
  });

  /* ---------------- 注册（必须凭卡密） ---------------- */
  app.post("/api/register", (req, res) => {
    const { username, password, cardCode } = req.body || {};
    const ip = userStore.getClientIp(req);
    const userAgent = String((req.headers && req.headers["user-agent"]) || "");

    if (!username || !password || !cardCode) {
      return res
        .status(400)
        .json({ ok: false, error: "用户名、密码和卡密均不能为空" });
    }

    if (userStore.checkLoginRateLimit(ip)) {
      return res
        .status(429)
        .json({ ok: false, error: "注册尝试过于频繁，请稍后再试" });
    }

    const result = userStore.registerUser({
      username,
      password,
      cardCode,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    userStore.recordLoginAttempt({
      username: result.data.username,
      success: true,
      ip,
      userAgent,
      reason: "注册成功",
    });

    return res.status(201).json({
      ok: true,
      data: {
        username: result.data.username,
      },
    });
  });

  /* ---------------- 卡密信息查询（公开） ---------------- */
  app.get("/api/card/info/:code", (req, res) => {
    const code = String((req.params && req.params.code) || "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "卡密不能为空" });
    }
    const info = userStore.getCardInfo(code);
    if (!info) {
      return res
        .status(404)
        .json({ ok: false, error: "卡密不存在或已使用" });
    }
    return res.json({ ok: true, data: info });
  });

  /* ---------------- 续费 ---------------- */
  app.post("/api/user/renew", requireAdminToken, (req, res) => {
    const currentUser = requireAuthUser(req, res);
    if (!currentUser) return;

    const cardCode = String((req.body && req.body.cardCode) || "").trim();
    if (!cardCode) {
      return res.status(400).json({ ok: false, error: "卡密不能为空" });
    }

    const result = userStore.renewUser({
      username: currentUser.username,
      cardCode,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    const refreshed = userStore.getUser(currentUser.username);
    if (typeof updateAdminSessions === "function" && refreshed) {
      updateAdminSessions(
        (session) =>
          session && session.username === currentUser.username,
        (session) => {
          Object.assign(session, {
            role: refreshed.role,
            accountLimit: refreshed.accountLimit,
            card: refreshed.card,
          });
        },
      );
    }

    return res.json({
      ok: true,
      data: {
        username: result.data.username,
        expiresAt: result.data.expiresAt,
        card: refreshed ? refreshed.card : null,
        accountLimit: refreshed ? refreshed.accountLimit : currentUser.accountLimit,
        cardType: result.data.cardType,
      },
    });
  });

  /* ---------------- 修改密码 ---------------- */
  app.post("/api/user/change-password", requireAdminToken, (req, res) => {
    const currentUser = requireAuthUser(req, res);
    if (!currentUser) return;

    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ ok: false, error: "原密码和新密码均不能为空" });
    }

    const result = userStore.changePassword({
      username: currentUser.username,
      oldPassword,
      newPassword,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    return res.json({ ok: true });
  });

  /* ---------------- 登录日志 ---------------- */
  app.get(
    "/api/admin/login-logs",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      const logs = userStore.getLoginLogs();
      const limited = logs.slice(0, ADMIN_LOGIN_LOG_LIMIT);
      const mapped = limited.map((log) => ({
        id: log.id,
        timestamp: log.createdAt
          ? new Date(log.createdAt).getTime()
          : Date.now(),
        event: log.success ? "login_success" : "login_failed",
        username: log.username,
        errorType: log.reason || null,
        ip: log.ip,
        userAgent: log.userAgent,
      }));
      return res.json({
        ok: true,
        data: { logs: mapped, total: mapped.length },
      });
    },
  );

  app.delete(
    "/api/admin/login-logs",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      userStore.clearLoginLogs();
      return res.json({ ok: true });
    },
  );
}

module.exports = { registerAdminAuthRoutes };
