import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { formatInfoDate, parseAppDate } from '../utils/datetime';

function toSecondBucket(value) {
  if (!value) return null;
  const d = parseAppDate(value);
  if (d) {
    return d.getTime() - d.getMilliseconds();
  }
  return null;
}

function labelForField(key) {
  if (key === 'part_number') return 'part_number';
  if (key === 'name') return 'name';
  if (key === 'description') return 'description';
  if (key === 'price') return 'price';
  if (key === 'image') return 'image';
  if (key === 'availability') return 'availability';
  if (key === 'part_removed') return 'part_removed';
  return key;
}

function displayFieldLabel(field, historyEvent) {
  if (field === 'availability') {
    if (historyEvent === 'deleted') return 'deleted';
    if (historyEvent === 'restored') return 'restored';
  }
  return labelForField(field);
}

export function ChangesHistory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        const response = await axios.get('/api/motorcycles/changes-history?limit=1500');
        setRows(response.data || []);
      } catch (error) {
        console.error('Error loading changes history:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = toSecondBucket(row.recorded_at);
      if (key === null) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([minuteTs, items]) => ({
        minuteTs,
        label: formatInfoDate(minuteTs),
        items
      }));
  }, [rows]);

  if (loading) return <div className="loading">Loading change history...</div>;

  return (
    <div className="changes-history-container">
      <h2>Scraper Change History</h2>
      {grouped.length === 0 ? (
        <div className="no-selections">
          <p>No updates recorded yet.</p>
        </div>
      ) : (
        <div className="changes-history-groups">
          {grouped.map((group) => (
            <section key={group.minuteTs} className="changes-history-group">
              <div className="changes-history-group-header">
                <span className="changes-history-time">{group.label}</span>
                <span className="changes-history-count">{group.items.length} updates</span>
              </div>
              <div className="changes-history-list">
                {group.items.map((item) => (
                  <div key={item.history_id} className="changes-history-item">
                    <div className="changes-history-title">
                      {[item.brand, item.model].filter(Boolean).join(' ')} | {item.current_part_number || item.old_part_number || '?'} | {item.current_name || item.old_name || ''}
                    </div>
                    <div className="changes-history-fields">
                      {(item.changed_fields || []).length > 0 ? (
                        (item.changed_fields || []).map((f) => (
                          <span key={`${item.history_id}-${f}`} className="changes-history-chip">{displayFieldLabel(f, item.history_event)}</span>
                        ))
                      ) : (
                        <span className="changes-history-chip">unknown</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

