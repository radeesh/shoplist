const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 7821;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static web app assets from public/
app.use(express.static(path.join(__dirname, 'public')));

// Server-Sent Events (SSE) active clients registry
let sseClients = [];
let nextClientId = 1;

function broadcast(eventType, data = {}) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// SSE Real-time Updates Endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const clientId = nextClientId++; // Date.now() collided when two devices connected in the same ms
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send initial ping connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
  });
});

// Health check endpoint for Docker & Portainer
app.get('/api/health', (req, res) => {
  try {
    const listCount = db.prepare('SELECT COUNT(*) as count FROM lists').get().count;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'connected',
      lists: listCount
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// --- LISTS API ---

// Get all active lists with item summary metrics
app.get('/api/lists', (req, res) => {
  try {
    const lists = db.prepare(`
      SELECT 
        l.id, l.name, l.icon, l.color, l.is_archived, l.created_at,
        COUNT(i.id) as total_items,
        SUM(CASE WHEN i.is_checked = 1 THEN 1 ELSE 0 END) as checked_items,
        COALESCE(SUM(i.estimated_price * i.quantity), 0) as total_estimated_cost
      FROM lists l
      LEFT JOIN items i ON l.id = i.list_id
      WHERE l.is_archived = 0
      GROUP BY l.id
      ORDER BY l.id ASC
    `).all();

    res.json({ success: true, data: lists });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new shopping list
app.post('/api/lists', (req, res) => {
  try {
    const { name, icon = '🛒', color = '#6366f1' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'List name is required' });
    }

    const stmt = db.prepare('INSERT INTO lists (name, icon, color) VALUES (?, ?, ?)');
    const info = stmt.run(name.trim(), icon, color);
    const newList = db.prepare('SELECT * FROM lists WHERE id = ?').get(info.lastInsertRowid);

    broadcast('LIST_CREATED', newList);
    res.status(201).json({ success: true, data: newList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update shopping list details
app.put('/api/lists/:id', (req, res) => {
  try {
    const { name, icon, color } = req.body;
    const stmt = db.prepare('UPDATE lists SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?');
    stmt.run(name, icon, color, req.params.id);

    const updatedList = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    broadcast('LIST_UPDATED', updatedList);
    res.json({ success: true, data: updatedList });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Archive list
app.delete('/api/lists/:id', (req, res) => {
  try {
    db.prepare('UPDATE lists SET is_archived = 1 WHERE id = ?').run(req.params.id);
    broadcast('LIST_DELETED', { id: parseInt(req.params.id) });
    res.json({ success: true, message: 'List archived successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CATEGORIES API ---

app.get('/api/categories', (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/categories', (req, res) => {
  try {
    const { name, icon = '📌', color = '#64748b' } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const stmt = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)');
    const info = stmt.run(name.trim(), icon, color);
    const newCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);

    broadcast('CATEGORY_CREATED', newCategory);
    res.status(201).json({ success: true, data: newCategory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ITEMS API ---

// Get items for a list
app.get('/api/lists/:listId/items', (req, res) => {
  try {
    const { listId } = req.params;
    const { search, category_id, is_checked } = req.query;

    let query = `
      SELECT 
        i.*,
        c.name as category_name, c.icon as category_icon, c.color as category_color, c.sort_order as category_sort
      FROM items i
      LEFT JOIN categories c ON i.category_id = c.id
      WHERE i.list_id = ?
    `;
    const params = [listId];

    if (search) {
      query += ` AND i.name LIKE ?`;
      params.push(`%${search}%`);
    }

    if (category_id) {
      query += ` AND i.category_id = ?`;
      params.push(category_id);
    }

    if (is_checked !== undefined) {
      query += ` AND i.is_checked = ?`;
      params.push(is_checked === 'true' ? 1 : 0);
    }

    query += ` ORDER BY i.is_checked ASC, i.sort_order ASC, c.sort_order ASC, i.id DESC`;

    const items = db.prepare(query).all(...params);
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add item to list (with smart quantity increment for existing items)
app.post('/api/lists/:listId/items', (req, res) => {
  try {
    const { listId } = req.params;
    const { name, category_id, quantity = 1, unit = 'pcs', estimated_price = 0, notes = '', priority = 'medium' } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Item name is required' });
    }

    const cleanName = name.trim();

    // Check if an unchecked item with the same name already exists in this list
    const existingItem = db.prepare(`
      SELECT * FROM items 
      WHERE list_id = ? AND LOWER(name) = LOWER(?) AND is_checked = 0
    `).get(listId, cleanName);

    if (existingItem) {
      const newQty = (existingItem.quantity || 1) + (parseFloat(quantity) || 1);
      db.prepare(`
        UPDATE items 
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(newQty, existingItem.id);

      const updatedItem = db.prepare(`
        SELECT i.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
        FROM items i 
        LEFT JOIN categories c ON i.category_id = c.id 
        WHERE i.id = ?
      `).get(existingItem.id);

      // Track usage in frequent_items table
      db.prepare(`
        INSERT INTO frequent_items (name, category_id, unit, usage_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET usage_count = usage_count + 1
      `).run(cleanName, category_id || null, unit);

      broadcast('ITEM_UPDATED', { listId: parseInt(listId), item: updatedItem });
      return res.status(200).json({ success: true, data: updatedItem, incremented: true });
    }

    const stmt = db.prepare(`
      INSERT INTO items (list_id, category_id, name, quantity, unit, estimated_price, notes, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(listId, category_id || null, cleanName, quantity, unit, estimated_price, notes, priority);
    const newItem = db.prepare(`
      SELECT i.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
      FROM items i 
      LEFT JOIN categories c ON i.category_id = c.id 
      WHERE i.id = ?
    `).get(info.lastInsertRowid);

    // Track usage in frequent_items table
    db.prepare(`
      INSERT INTO frequent_items (name, category_id, unit, usage_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(name) DO UPDATE SET usage_count = usage_count + 1
    `).run(cleanName, category_id || null, unit);

    broadcast('ITEM_ADDED', { listId: parseInt(listId), item: newItem });
    res.status(201).json({ success: true, data: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder items (drag-and-drop persistence)
app.post('/api/lists/:listId/reorder', (req, res) => {
  try {
    const { listId } = req.params;
    const { orderedIds } = req.body; // array of item IDs in new order

    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, error: 'orderedIds must be an array' });
    }

    const update = db.prepare('UPDATE items SET sort_order = ? WHERE id = ? AND list_id = ?');
    const reorderAll = db.transaction((ids) => {
      ids.forEach((id, index) => update.run(index, id, listId));
    });
    reorderAll(orderedIds);
    broadcast('ITEMS_REORDERED', { listId: parseInt(listId) });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update item (toggle checked or modify details)
app.patch('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const {
      is_checked,
      name,
      category_id,
      quantity,
      unit,
      estimated_price,
      actual_price,
      notes,
      priority
    } = req.body;

    const stmt = db.prepare(`
      UPDATE items SET
        is_checked = COALESCE(?, is_checked),
        name = COALESCE(?, name),
        category_id = COALESCE(?, category_id),
        quantity = COALESCE(?, quantity),
        unit = COALESCE(?, unit),
        estimated_price = COALESCE(?, estimated_price),
        actual_price = COALESCE(?, actual_price),
        notes = COALESCE(?, notes),
        priority = COALESCE(?, priority),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      is_checked !== undefined ? (is_checked ? 1 : 0) : null,
      name !== undefined ? name.trim() : null,
      category_id !== undefined ? category_id : null,
      quantity !== undefined ? quantity : null,
      unit !== undefined ? unit : null,
      estimated_price !== undefined ? estimated_price : null,
      actual_price !== undefined ? actual_price : null,
      notes !== undefined ? notes : null,
      priority !== undefined ? priority : null,
      id
    );

    const updatedItem = db.prepare(`
      SELECT i.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
      FROM items i 
      LEFT JOIN categories c ON i.category_id = c.id 
      WHERE i.id = ?
    `).get(id);

    broadcast('ITEM_UPDATED', { listId: existing.list_id, item: updatedItem });
    res.json({ success: true, data: updatedItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  try {
    const item = db.prepare('SELECT list_id FROM items WHERE id = ?').get(req.params.id);
    if (item) {
      db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
      broadcast('ITEM_DELETED', { listId: item.list_id, itemId: parseInt(req.params.id) });
    }
    res.json({ success: true, message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full export of ALL lists and ALL items
app.get('/api/export', (req, res) => {
  try {
    const lists = db.prepare(`SELECT * FROM lists WHERE is_archived = 0 ORDER BY created_at ASC`).all();
    const backupData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      lists: lists.map(list => {
        const items = db.prepare(`SELECT * FROM items WHERE list_id = ? ORDER BY id ASC`).all(list.id);
        return {
          name: list.name,
          color: list.color,
          items: items.map(i => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            estimated_price: i.estimated_price,
            is_checked: i.is_checked === 1,
            notes: i.notes,
            priority: i.priority
          }))
        };
      })
    };
    res.json({ success: true, data: backupData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Full import (handles either full multi-list backup or single list item array)
app.post('/api/import', (req, res) => {
  try {
    const { lists, items, targetListId } = req.body;

    // Case A: Full multi-list backup provided ({ lists: [ { name, items: [...] } ] })
    if (Array.isArray(lists) && lists.length > 0) {
      let totalListsCreated = 0;
      let totalItemsImported = 0;

      const importBackup = db.transaction((listArray) => {
        const listStmt = db.prepare(`INSERT INTO lists (name, color) VALUES (?, ?)`);
        const itemStmt = db.prepare(`
          INSERT INTO items (list_id, name, quantity, unit, estimated_price, is_checked, notes, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const l of listArray) {
          if (!l.name) continue;
          const result = listStmt.run(l.name.trim(), l.color || '#000000');
          const newListId = result.lastInsertRowid;
          totalListsCreated++;

          if (Array.isArray(l.items)) {
            for (const item of l.items) {
              if (!item.name) continue;
              itemStmt.run(
                newListId,
                item.name.trim(),
                item.quantity || 1,
                item.unit || 'pcs',
                item.estimated_price || 0,
                item.is_checked ? 1 : 0,
                item.notes || '',
                item.priority || 'medium'
              );
              totalItemsImported++;
            }
          }
        }
      });

      importBackup(lists);
      broadcast('LIST_CREATED', {});
      return res.json({ success: true, listsCreated: totalListsCreated, itemsImported: totalItemsImported });
    }

    // Case B: Single array of items for target list
    if (Array.isArray(items) && targetListId) {
      const stmt = db.prepare(`
        INSERT INTO items (list_id, name, quantity, unit, estimated_price, is_checked, notes, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((itemList) => {
        let inserted = 0;
        for (const item of itemList) {
          if (!item.name || !item.name.trim()) continue;
          stmt.run(
            targetListId,
            item.name.trim(),
            item.quantity || 1,
            item.unit || 'pcs',
            item.estimated_price || 0,
            item.is_checked ? 1 : 0,
            item.notes || '',
            item.priority || 'medium'
          );
          inserted++;
        }
        return inserted;
      });

      const count = insertMany(items);
      broadcast('ITEM_ADDED', { listId: parseInt(targetListId) });
      return res.json({ success: true, count, itemsImported: count });
    }

    res.status(400).json({ success: false, error: 'Invalid import format. Expected lists or items array.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch import items into a list
app.post('/api/lists/:listId/import', (req, res) => {
  try {
    const { listId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items provided for import' });
    }

    const stmt = db.prepare(`
      INSERT INTO items (list_id, name, quantity, unit, estimated_price, is_checked, notes, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((itemList) => {
      let inserted = 0;
      for (const item of itemList) {
        if (!item.name || !item.name.trim()) continue;
        stmt.run(
          listId,
          item.name.trim(),
          item.quantity || 1,
          item.unit || 'pcs',
          item.estimated_price || 0,
          item.is_checked ? 1 : 0,
          item.notes || '',
          item.priority || 'medium'
        );
        inserted++;
      }
      return inserted;
    });

    const count = insertMany(items);
    broadcast('ITEM_ADDED', { listId: parseInt(listId) });
    res.json({ success: true, count, message: `Successfully imported ${count} items` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear all completed/checked items from list
app.post('/api/lists/:listId/clear-completed', (req, res) => {
  try {
    const { listId } = req.params;
    const result = db.prepare('DELETE FROM items WHERE list_id = ? AND is_checked = 1').run(listId);
    broadcast('LIST_CLEARED', { listId: parseInt(listId), count: result.changes });
    res.json({ success: true, cleared: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset (uncheck) all items in list
app.post('/api/lists/:listId/reset', (req, res) => {
  try {
    const { listId } = req.params;
    const result = db.prepare('UPDATE items SET is_checked = 0 WHERE list_id = ?').run(listId);
    broadcast('LIST_RESET', { listId: parseInt(listId) });
    res.json({ success: true, reset: result.changes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- FREQUENT ITEMS API ---

app.get('/api/frequent-items', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT f.*, c.name as category_name, c.icon as category_icon, c.color as category_color
      FROM frequent_items f
      LEFT JOIN categories c ON f.category_id = c.id
      ORDER BY f.usage_count DESC, f.name ASC
      LIMIT 20
    `).all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🛒 Shopping List Local Server running on port ${PORT}`);
  console.log(`📡 Access URL: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
