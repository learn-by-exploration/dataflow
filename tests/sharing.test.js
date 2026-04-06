'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setup, cleanDb, teardown, makeUser, loginUser, authRequest, makeInvitedUser } = require('./helpers');

describe('Sharing', () => {
  let app, db;

  before(() => {
    ({ app, db } = setup());
  });

  after(() => teardown());

  describe('Item Sharing', () => {
    let admin, adminApi, member, memberApi, category, item;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);

      // Create category and item as admin
      const catRes = await adminApi.post('/api/categories').send({ name: 'Admin Cat' }).expect(201);
      category = catRes.body;
      const itemRes = await adminApi.post('/api/items').send({
        category_id: category.id,
        record_type_id: 1,
        title: 'Secret Item',
      }).expect(201);
      item = itemRes.body;
    });

    describe('POST /api/items/:id/share', () => {
      it('owner can share item with read permission', async () => {
        const res = await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);
        assert.equal(res.body.item_id, item.id);
        assert.equal(res.body.shared_with, member.id);
        assert.equal(res.body.permission, 'read');
      });

      it('owner can share item with write permission', async () => {
        const res = await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'write' })
          .expect(201);
        assert.equal(res.body.permission, 'write');
      });

      it('non-owner non-admin cannot share', async () => {
        // Create item as member
        const cat = await memberApi.post('/api/categories').send({ name: 'M Cat' }).expect(201);
        const mItem = await memberApi.post('/api/items').send({
          category_id: cat.body.id,
          record_type_id: 1,
          title: 'Member Item',
        }).expect(201);

        // Another member tries to share member's item
        const other = await makeInvitedUser(app, admin.sid, { role: 'adult' });
        const otherApi = authRequest(app, other.sid);
        await otherApi.post(`/api/items/${mItem.body.id}/share`)
          .send({ user_id: admin.id, permission: 'read' })
          .expect(403);
      });

      it('cannot share item with its owner', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: admin.id, permission: 'read' })
          .expect(400);
      });

      it('cannot share with non-existent user', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: 99999, permission: 'read' })
          .expect(404);
      });

      it('returns 404 for non-existent item', async () => {
        await adminApi.post('/api/items/99999/share')
          .send({ user_id: member.id, permission: 'read' })
          .expect(404);
      });

      it('updates permission if already shared', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);
        const res = await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'write' })
          .expect(201);
        assert.equal(res.body.permission, 'write');
      });
    });

    describe('GET /api/items/:id/shares', () => {
      it('owner can list shares', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        const res = await adminApi.get(`/api/items/${item.id}/shares`).expect(200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].shared_with, member.id);
      });

      it('non-owner cannot list shares', async () => {
        await memberApi.get(`/api/items/${item.id}/shares`).expect(403);
      });

      it('returns empty for item with no shares', async () => {
        const res = await adminApi.get(`/api/items/${item.id}/shares`).expect(200);
        assert.equal(res.body.length, 0);
      });
    });

    describe('DELETE /api/items/:id/share/:userId', () => {
      it('owner can revoke share', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        await adminApi.delete(`/api/items/${item.id}/share/${member.id}`).expect(204);

        const res = await adminApi.get(`/api/items/${item.id}/shares`).expect(200);
        assert.equal(res.body.length, 0);
      });

      it('revoked user loses access', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        // Member can see shared items
        let shared = await memberApi.get('/api/shared/items').expect(200);
        assert.equal(shared.body.length, 1);

        // Revoke
        await adminApi.delete(`/api/items/${item.id}/share/${member.id}`).expect(204);

        // Member no longer sees it
        shared = await memberApi.get('/api/shared/items').expect(200);
        assert.equal(shared.body.length, 0);
      });
    });

    describe('Shared item access', () => {
      it('shared user (read) can GET item', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        const res = await memberApi.get(`/api/items/${item.id}`).expect(200);
        assert.equal(res.body.shared, true);
        assert.equal(res.body.permission, 'read');
      });

      it('shared user (read) cannot PUT item', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        await memberApi.put(`/api/items/${item.id}`)
          .send({ favorite: true })
          .expect(403);
      });

      it('shared user (write) can PUT item', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'write' })
          .expect(201);

        const res = await memberApi.put(`/api/items/${item.id}`)
          .send({ favorite: true })
          .expect(200);
        assert.equal(res.body.shared, true);
        assert.equal(res.body.permission, 'write');
      });

      it('shared user cannot DELETE item', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'write' })
          .expect(201);

        await memberApi.delete(`/api/items/${item.id}`).expect(404);
      });

      it('non-shared user cannot GET item', async () => {
        await memberApi.get(`/api/items/${item.id}`).expect(404);
      });

      it('shared item returns decrypted fields when owner is online', async () => {
        // Admin created item with title 'Secret Item' and is logged in
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        const res = await memberApi.get(`/api/items/${item.id}`).expect(200);
        assert.equal(res.body.shared, true);
        assert.equal(res.body.title, 'Secret Item');
        assert.equal(res.body.encrypted, undefined, 'Should not have encrypted flag when owner online');
      });

      it('shared item returns error when owner vault is locked', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        // Logout admin to lock vault
        await adminApi.post('/api/auth/logout').expect(200);

        const res = await memberApi.get(`/api/items/${item.id}`).expect(200);
        assert.equal(res.body.shared, true);
        assert.equal(res.body.encrypted, true);
        assert.match(res.body.error, /vault is locked/i);
        assert.equal(res.body.title, undefined, 'Should not expose encrypted title');
      });

      it('shared item respects read/write permissions in response', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'write' })
          .expect(201);

        const res = await memberApi.get(`/api/items/${item.id}`).expect(200);
        assert.equal(res.body.shared, true);
        assert.equal(res.body.permission, 'write');
        assert.equal(res.body.title, 'Secret Item');
      });
    });

    describe('GET /api/shared/items', () => {
      it('returns items shared with me', async () => {
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        const res = await memberApi.get('/api/shared/items').expect(200);
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].id, item.id);
        assert.equal(res.body[0].shared, true);
      });

      it('returns empty when nothing shared', async () => {
        const res = await memberApi.get('/api/shared/items').expect(200);
        assert.equal(res.body.length, 0);
      });
    });

    describe('GET /api/items (includes shared)', () => {
      it('includes shared items with shared flag', async () => {
        // Member has own item
        const cat = await memberApi.post('/api/categories').send({ name: 'Own' }).expect(201);
        await memberApi.post('/api/items').send({
          category_id: cat.body.id,
          record_type_id: 1,
          title: 'My Own',
        }).expect(201);

        // Admin shares item with member
        await adminApi.post(`/api/items/${item.id}/share`)
          .send({ user_id: member.id, permission: 'read' })
          .expect(201);

        const res = await memberApi.get('/api/items').expect(200);
        const own = res.body.filter(i => !i.shared);
        const shared = res.body.filter(i => i.shared);
        assert.ok(own.length >= 1);
        assert.equal(shared.length, 1);
        assert.equal(shared[0].id, item.id);
      });
    });
  });

  describe('Category Sharing', () => {
    let admin, adminApi, member, memberApi, category;

    beforeEach(async () => {
      cleanDb();
      admin = await makeUser(app);
      const aLogin = await loginUser(app, admin);
      admin.sid = aLogin.sid;
      adminApi = authRequest(app, admin.sid);

      member = await makeInvitedUser(app, admin.sid, { role: 'adult' });
      memberApi = authRequest(app, member.sid);

      const catRes = await adminApi.post('/api/categories').send({ name: 'Shared Cat' }).expect(201);
      category = catRes.body;
    });

    it('owner can share category', async () => {
      const res = await adminApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: member.id, permission: 'read' })
        .expect(201);
      assert.equal(res.body.category_id, category.id);
      assert.equal(res.body.shared_with, member.id);
    });

    it('can list category shares', async () => {
      await adminApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: member.id, permission: 'write' })
        .expect(201);

      const res = await adminApi.get(`/api/categories/${category.id}/shares`).expect(200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].permission, 'write');
    });

    it('can revoke category share', async () => {
      await adminApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: member.id, permission: 'read' })
        .expect(201);

      await adminApi.delete(`/api/categories/${category.id}/share/${member.id}`).expect(204);

      const res = await adminApi.get(`/api/categories/${category.id}/shares`).expect(200);
      assert.equal(res.body.length, 0);
    });

    it('cannot share category with its owner', async () => {
      await adminApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: admin.id, permission: 'read' })
        .expect(400);
    });

    it('shared-with-me returns shared categories', async () => {
      await adminApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: member.id, permission: 'read' })
        .expect(201);

      const res = await memberApi.get('/api/shared/categories').expect(200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].id, category.id);
      assert.equal(res.body[0].shared, true);
    });

    it('non-owner cannot share category', async () => {
      await memberApi.post(`/api/categories/${category.id}/share`)
        .send({ user_id: member.id, permission: 'read' })
        .expect(403);
    });
  });
});
