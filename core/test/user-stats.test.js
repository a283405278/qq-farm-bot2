const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'user-stats-'));

const userStore = require('../src/models/user-store');

const PASSWORD = 'abc123A!';

function createTimeCard(days = 30) {
  const result = userStore.createCard({ type: 'time', days, description: 'test-card' });
  assert.equal(result.ok, true);
  return result.data.code;
}

function register(username, cardCode) {
  const result = userStore.registerUser({ username, password: PASSWORD, cardCode });
  assert.equal(result.ok, true);
  return result.data;
}

function expireUser(username, pastMs = 3600 * 1000) {
  const result = userStore.editUser({ username, update: { expiresAt: Date.now() - pastMs } });
  assert.equal(result.ok, true);
}

function banUser(username) {
  const result = userStore.editUser({ username, update: {}, cardUpdate: { enabled: false } });
  assert.equal(result.ok, true);
}

test('getUserStats 正确区分有效/过期/封禁/无卡用户', () => {
  register('validuser', createTimeCard());
  expireUser(register('expireduser', createTimeCard()).username);
  banUser(register('banneduser', createTimeCard()).username);
  userStore.addUser({ username: 'nocarduser', password: PASSWORD, role: 'user', accountLimit: 2 });
  userStore.addUser({ username: 'adminuser', password: PASSWORD, role: 'admin', accountLimit: 2 });

  const stats = userStore.getUserStats();
  assert.equal(stats.total, 6);
  assert.equal(stats.valid, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.banned, 2);
  assert.equal(stats.noCard, 1);
  assert.deepEqual(
    stats.expiredUsers.map((u) => u.username),
    ['expireduser'],
  );
});

test('cleanupExpiredUsers dryRun 仅预览不删除', () => {
  const result = userStore.cleanupExpiredUsers({ dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.usernames, ['expireduser']);
  assert.ok(userStore.findUser('expireduser'));
});

test('cleanupExpiredUsers 真实删除过期用户及其卡密', () => {
  const expiredUser = userStore.findUser('expireduser');
  const cardCode = expiredUser.cardCode;
  assert.ok(cardCode);
  assert.ok(userStore.getOneCardByCode(cardCode));

  const result = userStore.cleanupExpiredUsers();
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.usernames, ['expireduser']);

  assert.equal(userStore.findUser('expireduser'), null);
  assert.equal(userStore.getOneCardByCode(cardCode), null);

  const stats = userStore.getUserStats();
  assert.equal(stats.expired, 0);
  assert.equal(stats.total, 5);
});

test('cleanupExpiredUsers 无可清理时返回 0', () => {
  const result = userStore.cleanupExpiredUsers();
  assert.equal(result.ok, true);
  assert.equal(result.count, 0);
});

test('cleanupExpiredUsers 支持排除指定用户', () => {
  register('excludeduser', createTimeCard());
  expireUser('excludeduser');
  const result = userStore.cleanupExpiredUsers({ excludeUsernames: ['excludeduser'] });
  assert.equal(result.count, 0);
  assert.ok(userStore.findUser('excludeduser'));
});

const routes = require('../src/controllers/admin-user-manage-routes');

function createMockApp() {
  const handlers = { get: [], post: [], put: [], delete: [] };
  const app = {
    get: (route, ...args) => handlers.get.push({ route, handlers: args }),
    post: (route, ...args) => handlers.post.push({ route, handlers: args }),
    put: (route, ...args) => handlers.put.push({ route, handlers: args }),
    delete: (route, ...args) => handlers.delete.push({ route, handlers: args }),
  };
  return { app, handlers };
}

function invoke(handlersList, route, req, res) {
  const entry = handlersList.find((item) => item.route === route);
  assert.ok(entry, `未找到路由 ${route}`);
  for (const handler of entry.handlers) {
    const next = () => {};
    handler(req, res, next);
  }
}

function createRes() {
  const body = {};
  return {
    statusCode: 200,
    json(payload) {
      body.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    get payload() {
      return body.payload;
    },
  };
}

function registerRoutes() {
  const calls = [];
  const { app, handlers } = createMockApp();
  routes.registerAdminUserManageRoutes({
    app,
    logger: { warn() {} },
    userStore,
    requireAdminToken: (req, res, next) => {
      calls.push('token');
      req.currentUser = { username: 'admin', role: 'super_admin' };
      next();
    },
    requireAdminRole: (req, res, next) => {
      calls.push('role');
      next();
    },
    getAdminUserMutationError: () => null,
  });
  return { app, handlers, calls };
}

test('GET /api/admin/users/stats 返回统计并调用鉴权中间件', () => {
  const { handlers, calls } = registerRoutes();
  const res = createRes();
  invoke(handlers.get, '/api/admin/users/stats', {}, res);
  assert.deepEqual(calls, ['token', 'role']);
  assert.equal(res.payload.ok, true);
  assert.equal(typeof res.payload.data.total, 'number');
  assert.equal(typeof res.payload.data.valid, 'number');
  assert.equal(typeof res.payload.data.expired, 'number');
});

test('POST /api/admin/users/cleanup-expired 清理并排除当前管理员', () => {
  register('expiredforcleanup', createTimeCard());
  expireUser('expiredforcleanup');
  const { handlers } = registerRoutes();
  const res = createRes();
  invoke(handlers.post, '/api/admin/users/cleanup-expired', { body: {} }, res);
  assert.equal(res.payload.ok, true);
  assert.ok(res.payload.data.count >= 1);
  assert.ok(userStore.findUser('admin'), '管理员账号应被排除而不被清理');
});

test('POST /api/admin/users/cleanup-expired 支持 dryRun 预览', () => {
  register('expiredfordryrun', createTimeCard());
  expireUser('expiredfordryrun');
  const { handlers } = registerRoutes();
  const res = createRes();
  invoke(handlers.post, '/api/admin/users/cleanup-expired', { body: { dryRun: true } }, res);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.dryRun, true);
  assert.ok(res.payload.data.usernames.includes('expiredfordryrun'));
  assert.ok(userStore.findUser('expiredfordryrun'));
});
