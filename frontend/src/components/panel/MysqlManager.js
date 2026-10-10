// MysqlManager — slim controller for the cPanel-style MySQL UI.
// State, API calls and tab orchestration only. Presentational pieces are
// in ./mysql/ — DatabasesTab, HostsTab, Modals, QuotaBanner, shared.
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import PanelToolbar from './shared/PanelToolbar';
import DatabasesTab from './mysql/DatabasesTab';
import HostsTab from './mysql/HostsTab';
import QuotaBanner from './mysql/QuotaBanner';
import {
  CreateDbModal, CreateUserModal,
  ChangePasswordModal, AssignPrivilegesModal,
} from './mysql/Modals';
import {
  SvgPlus, SvgKey, SvgExternal,
  generatePassword, prefixed, isQuotaError,
  tabBtnStyle, alertStyle,
} from './mysql/shared';

export default function MysqlManager() {
  const { t } = useTranslation();
  const { api, user } = useAuth();
  const cpUser = user?.username || '';
  const isGold = !!user?.isGold;

  const [tab, setTab] = useState('databases'); // databases | hosts

  // Per-tab loading — Hosts tab is interactive immediately while Databases is fetching.
  const [loadingDbs, setLoadingDbs] = useState(true);
  const [loadingHosts, setLoadingHosts] = useState(true);

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [quotaErr, setQuotaErr] = useState(''); // when cPanel rejects with "maximum reached"

  const [databases, setDatabases] = useState([]);
  const [dbUsers, setDbUsers] = useState([]);
  const [remoteHosts, setRemoteHosts] = useState([]);

  // Modal state
  const [showCreateDb, setShowCreateDb] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [assignFor, setAssignFor] = useState(null); // { user } — opens privilege modal
  const [pwdFor, setPwdFor] = useState(null); // { user } — opens reset password modal

  const [dbName, setDbName] = useState('');
  const [userName, setUserName] = useState('');
  const [userPass, setUserPass] = useState('');
  const [assignDb, setAssignDb] = useState('');
  const [assignAllPriv, setAssignAllPriv] = useState(true);
  const [assignPrivs, setAssignPrivs] = useState(() => new Set(['ALL PRIVILEGES']));
  const [resetPass, setResetPass] = useState('');
  const [newHost, setNewHost] = useState('');
  const [busy, setBusy] = useState(false);

  const [showPm, setShowPm] = useState(false); // launching phpMyAdmin

  // ─── Fetchers ───────────────────────────────────────────────
  const fetchDbsAndUsers = useCallback(async () => {
    setLoadingDbs(true);
    setError('');
    try {
      const res = await api('/mysql/databases');
      if (res.databases?.errors?.length) setError(res.databases.errors[0]);
      const dbList = res.databases?.data || [];
      // UAPI returns either [{ database, users:[], disk_usage }] or { databases:[...] }
      const normalizedDbs = Array.isArray(dbList) ? dbList : (dbList.databases || []);
      setDatabases(normalizedDbs);

      const uList = res.users?.data || [];
      const normalizedUsers = Array.isArray(uList) ? uList : (uList.users || []);
      setDbUsers(normalizedUsers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDbs(false);
    }
  }, [api]);

  const fetchHosts = useCallback(async () => {
    setLoadingHosts(true);
    try {
      const res = await api('/mysql/remote-hosts');
      const list = res.data || [];
      setRemoteHosts(Array.isArray(list) ? list : (list.hosts || []));
    } catch (_) {
      // Non-fatal — the hosts tab is still usable for adding new entries.
    } finally {
      setLoadingHosts(false);
    }
  }, [api]);

  // Fire both fetchers in parallel on mount. Each has its own loading state
  // so the Hosts tab becomes interactive the moment its (faster) call returns,
  // independent of the slower Databases call.
  useEffect(() => {
    fetchDbsAndUsers();
    fetchHosts();
  }, [fetchDbsAndUsers, fetchHosts]);

  // ─── Action handlers ────────────────────────────────────────
  const handleCreateDb = async () => {
    const raw = dbName.trim();
    if (!raw) return;
    setBusy(true); setError(''); setInfo(''); setQuotaErr('');
    try {
      const full = prefixed(cpUser, raw);
      const res = await api('/mysql/databases/create', {
        method: 'POST',
        body: JSON.stringify({ name: full }),
      });
      if (res.errors?.length) {
        if (isQuotaError(res.errors[0])) setQuotaErr(res.errors[0]);
        else setError(res.errors[0]);
      } else {
        setInfo(t('mysql.dbCreated', { name: full, defaultValue: `Database "${full}" created.` }));
        setDbName('');
        setShowCreateDb(false);
        fetchDbsAndUsers();
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDeleteDb = async (name) => {
    if (!window.confirm(t('mysql.confirmDeleteDb', { name, defaultValue: `Delete database "${name}"? This cannot be undone.` }))) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/databases/delete', {
        method: 'POST', body: JSON.stringify({ name }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else { setInfo(t('mysql.dbDeleted', { defaultValue: 'Database deleted.' })); fetchDbsAndUsers(); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleCreateUser = async () => {
    const raw = userName.trim();
    if (!raw || !userPass) return;
    if (userPass.length < 8) {
      setError(t('mysql.errPassShort', { defaultValue: 'Password must be at least 8 characters.' }));
      return;
    }
    setBusy(true); setError(''); setInfo(''); setQuotaErr('');
    try {
      const full = prefixed(cpUser, raw);
      const res = await api('/mysql/users/create', {
        method: 'POST', body: JSON.stringify({ name: full, password: userPass }),
      });
      if (res.errors?.length) {
        if (isQuotaError(res.errors[0])) setQuotaErr(res.errors[0]);
        else setError(res.errors[0]);
      } else {
        setInfo(t('mysql.userCreated', { name: full, defaultValue: `User "${full}" created.` }));
        setUserName(''); setUserPass(''); setShowCreateUser(false);
        fetchDbsAndUsers();
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDeleteUser = async (name) => {
    if (!window.confirm(t('mysql.confirmDeleteUser', { name, defaultValue: `Delete user "${name}"?` }))) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/users/delete', {
        method: 'POST', body: JSON.stringify({ name }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else { setInfo(t('mysql.userDeleted', { defaultValue: 'User deleted.' })); fetchDbsAndUsers(); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleResetPassword = async () => {
    if (!pwdFor || !resetPass) return;
    if (resetPass.length < 8) {
      setError(t('mysql.errPassShort', { defaultValue: 'Password must be at least 8 characters.' }));
      return;
    }
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/users/password', {
        method: 'POST', body: JSON.stringify({ user: pwdFor.user, password: resetPass }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else {
        setInfo(t('mysql.pwdChanged', { defaultValue: 'Password updated.' }));
        setPwdFor(null); setResetPass('');
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleAssign = async () => {
    if (!assignFor || !assignDb) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const privs = assignAllPriv ? ['ALL PRIVILEGES'] : Array.from(assignPrivs);
      if (!privs.length) {
        setError(t('mysql.errNoPrivs', { defaultValue: 'Pick at least one privilege.' }));
        setBusy(false); return;
      }
      const res = await api('/mysql/privileges/grant', {
        method: 'POST',
        body: JSON.stringify({ user: assignFor.user, database: assignDb, privileges: privs }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else {
        setInfo(t('mysql.privsGranted', { defaultValue: 'Privileges granted.' }));
        setAssignFor(null); setAssignDb('');
        setAssignPrivs(new Set(['ALL PRIVILEGES']));
        setAssignAllPriv(true);
        fetchDbsAndUsers();
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleRevoke = async (userToRevoke, database) => {
    if (!window.confirm(t('mysql.confirmRevoke', { user: userToRevoke, db: database, defaultValue: `Revoke "${userToRevoke}" from "${database}"?` }))) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/privileges/revoke', {
        method: 'POST', body: JSON.stringify({ user: userToRevoke, database }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else { setInfo(t('mysql.revoked', { defaultValue: 'Access revoked.' })); fetchDbsAndUsers(); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleAddHost = async () => {
    const h = newHost.trim();
    if (!h) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/remote-hosts/add', {
        method: 'POST', body: JSON.stringify({ host: h }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else { setInfo(t('mysql.hostAdded', { host: h, defaultValue: `Host "${h}" allowed.` })); setNewHost(''); fetchHosts(); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const handleDeleteHost = async (host) => {
    if (!window.confirm(t('mysql.confirmDeleteHost', { host, defaultValue: `Remove host "${host}"?` }))) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const res = await api('/mysql/remote-hosts/delete', {
        method: 'POST', body: JSON.stringify({ host }),
      });
      if (res.errors?.length) setError(res.errors[0]);
      else { setInfo(t('mysql.hostRemoved', { defaultValue: 'Host removed.' })); fetchHosts(); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const openPhpMyAdmin = async () => {
    setShowPm(true); setError('');
    try {
      const res = await api('/mysql/phpmyadmin');
      if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
      } else {
        setError(res.errors?.[0] || t('mysql.pmaFail', { defaultValue: 'Could not open phpMyAdmin.' }));
      }
    } catch (err) { setError(err.message); }
    finally { setShowPm(false); }
  };

  // ─── Derived data ───────────────────────────────────────────
  // Map: dbName → [users] (from databases list, when UAPI returns it inline)
  const dbUserMap = useMemo(() => {
    const m = {};
    for (const db of databases) {
      const name = db.database || db.name;
      if (!name) continue;
      m[name] = db.users || [];
    }
    return m;
  }, [databases]);

  // Inverse: userName → [databases they can access]
  const userDbMap = useMemo(() => {
    const m = {};
    for (const db of databases) {
      const name = db.database || db.name;
      if (!name) continue;
      for (const u of (db.users || [])) {
        const uname = typeof u === 'string' ? u : (u.user || u.name);
        if (!uname) continue;
        if (!m[uname]) m[uname] = [];
        m[uname].push(name);
      }
    }
    return m;
  }, [databases]);

  // ─── Toolbar ────────────────────────────────────────────────
  const toolbarActions = [
    {
      key: 'pma',
      label: showPm
        ? t('mysql.opening', { defaultValue: 'Opening…' })
        : t('mysql.openPma', { defaultValue: 'Open phpMyAdmin' }),
      icon: SvgExternal,
      variant: 'ghost',
      onClick: openPhpMyAdmin,
      disabled: showPm,
      title: t('mysql.pmaTip', { defaultValue: 'Browse tables and run SQL queries in phpMyAdmin.' }),
      testid: 'mysql-open-pma',
    },
  ];
  if (tab === 'databases') {
    toolbarActions.push(
      {
        key: 'new-user',
        label: t('mysql.newUser', { defaultValue: 'New user' }),
        icon: SvgKey,
        variant: 'ghost',
        onClick: () => { setShowCreateUser(true); setUserPass(generatePassword()); },
        testid: 'mysql-new-user-btn',
      },
      {
        key: 'new-db',
        label: t('mysql.newDb', { defaultValue: 'New database' }),
        icon: SvgPlus,
        variant: 'primary',
        onClick: () => setShowCreateDb(true),
        testid: 'mysql-new-db-btn',
      },
    );
  }


  return (
    <div className="email-manager mysql-manager" data-testid="mysql-manager">
      <PanelToolbar
        testid="mysql-toolbar"
        leftSlot={
          <div className="panel-toolbar-title">
            <h2>{t('mysql.title', { defaultValue: 'MySQL Databases' })}</h2>
            <span className="panel-toolbar-title-meta">
              {t('mysql.subtitle', { defaultValue: 'Manage your databases, users and remote access.' })}
            </span>
          </div>
        }
        actions={toolbarActions}
      />

      {/* Tabs */}
      <div
        className="mysql-tabs"
        style={{
          display: 'flex',
          gap: 8,
          margin: '12px 0 16px',
          borderBottom: '1px solid var(--border, #2a2f3a)',
        }}
      >
        <button
          type="button"
          className={`tab-btn ${tab === 'databases' ? 'active' : ''}`}
          onClick={() => setTab('databases')}
          style={tabBtnStyle(tab === 'databases')}
          data-testid="mysql-subtab-databases"
        >
          {t('mysql.tabDatabases', { defaultValue: 'Databases & Users' })}
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'hosts' ? 'active' : ''}`}
          onClick={() => setTab('hosts')}
          style={tabBtnStyle(tab === 'hosts')}
          data-testid="mysql-subtab-hosts"
        >
          {t('mysql.tabHosts', { defaultValue: 'Remote MySQL' })}
        </button>
      </div>

      {quotaErr && (
        <QuotaBanner
          message={quotaErr}
          onDismiss={() => setQuotaErr('')}
          t={t}
        />
      )}
      {error && (
        <div className="alert alert-error" data-testid="mysql-error" style={alertStyle('#3a1f24', '#ff6b7a')}>
          {error}
        </div>
      )}
      {info && (
        <div className="alert alert-info" data-testid="mysql-info" style={alertStyle('#1f3a2a', '#5fd897')}>
          {info}
        </div>
      )}

      {tab === 'databases' ? (
        <DatabasesTab
          loading={loadingDbs}
          databases={databases}
          dbUsers={dbUsers}
          dbUserMap={dbUserMap}
          userDbMap={userDbMap}
          onDeleteDb={handleDeleteDb}
          onDeleteUser={handleDeleteUser}
          onAssign={(u) => {
            setAssignFor({ user: u });
            setAssignDb(databases[0]?.database || databases[0]?.name || '');
          }}
          onResetPwd={(u) => { setPwdFor({ user: u }); setResetPass(generatePassword()); }}
          onRevoke={handleRevoke}
          t={t}
        />
      ) : (
        <HostsTab
          loading={loadingHosts}
          hosts={remoteHosts}
          newHost={newHost}
          setNewHost={setNewHost}
          onAdd={handleAddHost}
          onDelete={handleDeleteHost}
          busy={busy}
          t={t}
        />
      )}

      {/* Modals */}
      {showCreateDb && (
        <CreateDbModal
          t={t}
          cpUser={cpUser}
          dbName={dbName}
          setDbName={setDbName}
          busy={busy}
          onClose={() => setShowCreateDb(false)}
          onSubmit={handleCreateDb}
        />
      )}
      {showCreateUser && (
        <CreateUserModal
          t={t}
          cpUser={cpUser}
          userName={userName}
          setUserName={setUserName}
          userPass={userPass}
          setUserPass={setUserPass}
          busy={busy}
          onClose={() => setShowCreateUser(false)}
          onSubmit={handleCreateUser}
        />
      )}
      <ChangePasswordModal
        t={t}
        pwdFor={pwdFor}
        resetPass={resetPass}
        setResetPass={setResetPass}
        busy={busy}
        onClose={() => setPwdFor(null)}
        onSubmit={handleResetPassword}
      />
      <AssignPrivilegesModal
        t={t}
        assignFor={assignFor}
        databases={databases}
        assignDb={assignDb}
        setAssignDb={setAssignDb}
        assignAllPriv={assignAllPriv}
        setAssignAllPriv={setAssignAllPriv}
        assignPrivs={assignPrivs}
        setAssignPrivs={setAssignPrivs}
        busy={busy}
        onClose={() => setAssignFor(null)}
        onSubmit={handleAssign}
      />
    </div>
  );
}
