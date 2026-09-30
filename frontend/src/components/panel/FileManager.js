import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthContext';
import Toolbar from './file-manager/Toolbar';
import BulkBar from './file-manager/BulkBar';
import DragOverlay from './file-manager/DragOverlay';
import ImagePreviewModal from './file-manager/ImagePreviewModal';
import useHotkeys from './file-manager/useHotkeys';
import AntiRedStatusCard from './AntiRedStatusCard';
import { pickErrorMessage, friendlyMessage, isTransientError } from './shared/cpanelErrors';

export default function FileManager({ targetDir, onTargetDirConsumed }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en').slice(0, 2);
  const { api, user } = useAuth();
  const [files, setFiles] = useState([]);
  const [currentDir, setCurrentDir] = useState(`/home/${user?.username}/public_html`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Tracks the RAW upstream error string behind the user-facing `error` banner.
  // We can't just regex-match `error` for transience because by then it has
  // been localized ("Your hosting server is responding slowly…"). Keeping the
  // raw axios/cpanel message lets the banner decide whether to offer a Retry.
  const [errorRaw, setErrorRaw] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [extracting, setExtracting] = useState(null);
  const [showNewDir, setShowNewDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [editingFile, setEditingFile] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [copyMoveAction, setCopyMoveAction] = useState(null);
  const [destDir, setDestDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null); // { fileName, isDir } | { bulk: true, items: [{name,isDir}] }
  const [deleting, setDeleting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dismissedGuide, setDismissedGuide] = useState(() => {
    return sessionStorage.getItem('panel_guide_dismissed') === 'true';
  });
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [bulkMoveTarget, setBulkMoveTarget] = useState(null); // { destDir }
  const [imagePreview, setImagePreview] = useState(null); // { name, url }
  // Elapsed-seconds counter while uploading — drives the "(0:23)" suffix and
  // the "still working" slow-warning banner so users on a flaky mobile link
  // don't think the upload hung. Reset when upload starts / finishes.
  const [uploadElapsed, setUploadElapsed] = useState(0);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const searchRef = useRef(null);

  const isPublicHtml = currentDir.includes('/public_html');
  const isPublicHtmlRoot = currentDir.endsWith('/public_html') || currentDir.endsWith('/public_html/');

  const fetchFiles = useCallback(async (dir) => {
    setLoading(true);
    setError('');
    setErrorRaw('');
    try {
      const res = await api(`/files?dir=${encodeURIComponent(dir)}`);
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError(pickErrorMessage(res, t, lang));
        setErrorRaw((res.errors && res.errors[0]) || res.code || '');
        setFiles([]);
      } else {
        const items = res.data || [];
        items.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return (a.file || '').localeCompare(b.file || '');
        });
        setFiles(items);
      }
    } catch (err) {
      // Map raw axios error strings ("timeout of 30000ms exceeded", "ECONNREFUSED")
      // to the localized "cpanelSlow" / "cpanelUnreachable" copy so users see a
      // calm, actionable message instead of engineering jargon after login.
      setError(friendlyMessage(err.message, t) || err.message);
      setErrorRaw(err.message || '');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchFiles(currentDir);
  }, [currentDir, fetchFiles]);

  // Cross-tab navigation: when DomainList sends a targetDir, navigate to it
  useEffect(() => {
    if (targetDir) {
      setCurrentDir(targetDir);
      if (onTargetDirConsumed) onTargetDirConsumed();
    }
  }, [targetDir, onTargetDirConsumed]);


  // Reset selection + search when changing directory
  useEffect(() => {
    setSelected(new Set());
    setSearch('');
  }, [currentDir]);

  // Drive the uploadElapsed counter (seconds) while an upload is in flight —
  // without this the user sees a static "Uploading foo.rar" for 30-120s while
  // a slow cPanel server hangs the axios request and thinks the panel froze.
  useEffect(() => {
    if (!uploading) {
      setUploadElapsed(0);
      return undefined;
    }
    const t0 = Date.now();
    setUploadElapsed(0);
    const id = setInterval(() => {
      setUploadElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [uploading]);

  // Holder for visible-files reference used by keyboard handlers
  const visibleFilesRef = useRef([]);

  // Keyboard shortcuts: '/' focuses search, Esc cascades close, Ctrl/Cmd+A
  // selects all, Delete/Backspace prompts bulk delete. Logic lives in
  // ./file-manager/useHotkeys.js.
  useHotkeys({
    searchRef,
    visibleFilesRef,
    selected,
    setSelected,
    search,
    setSearch,
    showNewDir,
    setShowNewDir,
    setNewDirName,
    editingFile,
    setEditingFile,
    renaming,
    setRenaming,
    copyMoveAction,
    setCopyMoveAction,
    deleteTarget,
    setDeleteTarget,
    bulkMoveTarget,
    setBulkMoveTarget,
    imagePreview,
    setImagePreview,
    deleting,
  });

  // Drag and drop handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // Recursively walk a FileSystemDirectoryEntry, returning Files tagged with
  // their relative path (e.g. "mysite/css/style.css"). Browsers expose this
  // via the non-standard but widely-supported `webkitGetAsEntry()` API.
  const walkEntry = (entry, path = '') => new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => {
        // Attach a relativePath to the File so uploadFiles can preserve folder structure.
        try { Object.defineProperty(f, 'relativePath', { value: path + entry.name, configurable: true }); } catch (_) {}
        resolve([f]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (!entries.length) {
            const nested = await Promise.all(collected.map(e => walkEntry(e, path + entry.name + '/')));
            resolve(nested.flat());
            return;
          }
          collected.push(...entries);
          readBatch(); // browsers may return entries in batches; keep reading until empty
        }, () => resolve([]));
      };
      readBatch();
    } else {
      resolve([]);
    }
  });

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const items = e.dataTransfer.items ? Array.from(e.dataTransfer.items) : [];
    const supportsEntries = items.length && typeof items[0].webkitGetAsEntry === 'function';

    let droppedFiles = [];
    if (supportsEntries) {
      // Modern path — handles folders (and nested folders).
      const entries = items
        .map(i => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
        .filter(Boolean);
      const nested = await Promise.all(entries.map(en => walkEntry(en, '')));
      droppedFiles = nested.flat();
    } else {
      // Fallback: flat file list (older browsers, no folder traversal).
      droppedFiles = Array.from(e.dataTransfer.files);
    }

    if (droppedFiles.length > 0) {
      await uploadFiles(droppedFiles);
    }
  };

  const navigate = (dirName) => {
    const newDir = currentDir.endsWith('/') ? currentDir + dirName : currentDir + '/' + dirName;
    setCurrentDir(newDir);
  };

  const goUp = () => {
    const parts = currentDir.split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    setCurrentDir(parent);
  };

  // Auto-switch to chunked upload for files >8 MB to avoid Railway's ~60s
  // per-request ingress timeout (which previously caused large .zip uploads
  // to be cut mid-body and logged as "aborted before multer finished").
  const CHUNK_THRESHOLD = 8 * 1024 * 1024 // 8 MB
  const CHUNK_SIZE = 5 * 1024 * 1024      // 5 MB

  const uploadFileChunked = async (file, targetDir, overrideFileName) => {
    const dir = targetDir || currentDir;
    const fileName = overrideFileName || file.name;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    for (let idx = 0; idx < totalChunks; idx++) {
      const start = idx * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const blob = file.slice(start, end)
      const formData = new FormData()
      formData.append('chunk', blob, fileName)
      formData.append('uploadId', uploadId)
      formData.append('chunkIndex', String(idx))
      formData.append('totalChunks', String(totalChunks))
      formData.append('fileName', fileName)
      formData.append('dir', dir)
      formData.append('fileSize', String(file.size))
      setUploadProgress(`Uploading ${fileName} — chunk ${idx + 1}/${totalChunks} (${Math.round(((idx + 1) / totalChunks) * 100)}%)`)
      const res = await api('/files/upload-chunk', { method: 'POST', body: formData })
      // Last chunk returns the final cPanel response; any error is thrown by `api`
      if (idx === totalChunks - 1 && (res?.errors?.length || res?.code === 'CPANEL_DOWN')) {
        throw new Error(pickErrorMessage(res, t, lang))
      }
    }
  }

  // Ensure a subdirectory tree exists under currentDir. Idempotent: ignores
  // "already exists" errors so the same upload can be retried safely.
  // segments: e.g. ["mysite", "css"] (no leading/trailing slashes).
  const ensureSubdir = async (segments, createdSet) => {
    let parent = currentDir;
    for (const seg of segments) {
      if (!seg) continue;
      const full = parent.endsWith('/') ? parent + seg : parent + '/' + seg;
      if (!createdSet.has(full)) {
        try {
          await api('/files/mkdir', {
            method: 'POST',
            body: JSON.stringify({ dir: parent, name: seg }),
          });
        } catch (err) {
          // cPanel returns errors via response shape; `api` already throws on
          // !res.ok. If the directory already exists or a parallel call wins,
          // we ignore — subsequent file PUT will surface real failures.
          if (!/exist|EEXIST/i.test(err?.message || '')) {
            // Re-throw only if it's a non-existence error so callers can decide.
            throw err;
          }
        }
        createdSet.add(full);
      }
      parent = full;
    }
    return parent;
  };

  const uploadFiles = async (selected) => {
    if (!selected.length) return;
    setUploading(true);
    setError('');
    setSuccessMessage('');
    const total = selected.length;
    let done = 0;
    let failures = [];
    const createdDirs = new Set();
    // Detect whether any file came in with a relative path (folder upload).
    const isFolderUpload = selected.some(f => f.relativePath || f.webkitRelativePath);
    try {
      for (const file of selected) {
        try {
          // Resolve target subdir from file.relativePath (drag/drop folder) or
          // file.webkitRelativePath (input[webkitdirectory]). Falls back to the
          // current directory for plain file drops.
          const rel = file.relativePath || file.webkitRelativePath || '';
          const parts = rel.split('/').filter(Boolean);
          const fileName = parts.length ? parts[parts.length - 1] : file.name;
          const subdirParts = parts.slice(0, -1);
          let targetDir = currentDir;
          if (subdirParts.length) {
            targetDir = await ensureSubdir(subdirParts, createdDirs);
          }
          setUploadProgress(`Uploading ${done + 1}/${total}: ${rel || file.name}`);
          if (file.size > CHUNK_THRESHOLD) {
            await uploadFileChunked(file, targetDir, fileName);
          } else {
            const formData = new FormData();
            // Multer reads originalname from the third arg of File/Blob
            // (or the File's own .name). Pass a fresh File-like with the
            // resolved name so any nested folder name segments are honoured.
            formData.append('file', file, fileName);
            formData.append('dir', targetDir);
            const res = await api('/files/upload', { method: 'POST', body: formData });
            // The /files/upload route returns HTTP 200 even when the upstream
            // cPanel UAPI call failed (shape: { status: 0, errors: [msg], data: null }).
            // Without this check the loop previously counted those as successful
            // uploads and showed a "File uploaded successfully!" toast while the
            // file had not actually reached the server — the exact silent-fail
            // the @ciroovblzz "upload forever" report pointed at.
            if (res?.errors?.length || res?.code === 'CPANEL_DOWN') {
              throw new Error(pickErrorMessage(res, t, lang));
            }
          }
          done++;
        } catch (err) {
          failures.push({ name: file.relativePath || file.webkitRelativePath || file.name, msg: friendlyUploadError(err) });
        }
      }

      if (failures.length === 0) {
        if (isFolderUpload) {
          const dirCount = createdDirs.size;
          setSuccessMessage(`${done} file${done === 1 ? '' : 's'} uploaded across ${dirCount} folder${dirCount === 1 ? '' : 's'}.`);
        } else if (total === 1) {
          const uploadedUrl = getPublicUrl(selected[0].name, false);
          setSuccessMessage(uploadedUrl
            ? `File uploaded successfully! View it at: ${uploadedUrl}`
            : `File uploaded successfully!`);
        } else {
          setSuccessMessage(`${done} files uploaded successfully!`);
        }
        setTimeout(() => setSuccessMessage(''), 8000);
      } else {
        const first = failures[0];
        setError(failures.length === 1
          ? `${first.name}: ${first.msg}`
          : `${done}/${total} uploaded — ${failures.length} failed. First error — ${first.name}: ${first.msg}`);
      }

      fetchFiles(currentDir);
    } finally {
      setUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files || []);
    await uploadFiles(selected);
  };

  const friendlyUploadError = (err) => {
    const m = String(err?.message || err || '');
    if (/499|aborted|cancelled|interrupted/i.test(m)) {
      return 'Upload interrupted. For files over 8 MB the panel auto-chunks — just retry. For very large sites (>100 MB), zip into parts.';
    }
    if (/413|exceeded|too large|LIMIT_FILE_SIZE|max .* MB/i.test(m)) {
      return 'File exceeds the 120 MB cap. Split your archive into smaller parts, upload each, then use Extract.';
    }
    if (/500/.test(m)) {
      return 'Server error during upload. Try again, or upload a .zip and use Extract.';
    }
    return m || 'Upload failed.';
  };

  const handleDelete = (fileName, isDir = false) => {
    // Open a custom in-app confirmation modal — native window.confirm() is unreliable
    // inside Telegram WebApp and some mobile in-app browsers (silently returns false).
    setDeleteTarget({ fileName, isDir });
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    if (deleteTarget.bulk) {
      await performBulkDelete();
      return;
    }
    const { fileName, isDir } = deleteTarget;
    setDeleting(true);
    setError('');
    try {
      const res = await api('/files/delete', {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, file: fileName, isDirectory: isDir }),
      });
      // A broken-homedir EPERM (and any soft failure) comes back HTTP 200 with
      // status:0 — treat it as a failure, don't show a false "deleted".
      if (res && res.status === 0) {
        throw new Error(pickErrorMessage(res, t, lang) || res.error || `Could not delete ${fileName}`);
      }
      setDeleteTarget(null);
      setSuccessMessage(`${isDir ? 'Folder' : 'File'} deleted: ${fileName}`);
      setTimeout(() => setSuccessMessage(''), 4000);
      fetchFiles(currentDir);
    } catch (err) {
      // Surface the real cPanel error (e.g., "not a regular file", permissions)
      setError(err.message || `Could not delete ${fileName}`);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleExtract = async (fileName) => {
    setExtracting(fileName);
    setError('');
    setSuccessMessage('');
    try {
      const res = await api('/files/extract', {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, file: fileName, destDir: currentDir }),
      });
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError((res.code === 'CPANEL_DOWN' || res.code === 'CPANEL_UAPI_EPERM')
          ? pickErrorMessage(res, t, lang)
          : `Extract failed: ${res.errors[0]}`);
      } else {
        const folderName = fileName.replace(/\.(zip|tar\.gz|tgz|tar)$/i, '');
        const extractedUrl = getPublicUrl(folderName, true);
        if (extractedUrl) {
          setSuccessMessage(`Files extracted! Your site should now be live at: ${extractedUrl}`);
          setTimeout(() => setSuccessMessage(''), 12000);
        } else {
          setSuccessMessage('Files extracted successfully!');
          setTimeout(() => setSuccessMessage(''), 8000);
        }
        fetchFiles(currentDir);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(null);
    }
  };

  const handleCreateDir = async () => {
    if (!newDirName.trim()) return;
    setError('');
    try {
      const res = await api('/files/mkdir', {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, name: newDirName.trim() }),
      });
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError((res.code === 'CPANEL_DOWN' || res.code === 'CPANEL_UAPI_EPERM')
          ? pickErrorMessage(res, t, lang)
          : `Create folder failed: ${res.errors[0]}`);
      } else {
        setNewDirName('');
        setShowNewDir(false);
        fetchFiles(currentDir);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = async (fileName) => {
    setError('');
    try {
      const res = await api(`/files/content?dir=${encodeURIComponent(currentDir)}&file=${encodeURIComponent(fileName)}`);
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError(pickErrorMessage(res, t, lang));
      } else {
        setEditingFile(fileName);
        setEditContent(res.data?.content || '');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api('/files/save', {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, file: editingFile, content: editContent }),
      });
      setEditingFile(null);
      setEditContent('');
      fetchFiles(currentDir);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (oldName) => {
    if (!renameValue.trim() || renameValue.trim() === oldName) {
      setRenaming(null);
      return;
    }
    try {
      await api('/files/rename', {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, oldName, newName: renameValue.trim() }),
      });
      setRenaming(null);
      setRenameValue('');
      fetchFiles(currentDir);
    } catch (err) {
      setError(err.message);
    }
  };

  const openCopyMove = (type, fileName) => {
    setCopyMoveAction({ type, fileName });
    setDestDir(currentDir);
    setError('');
  };

  const handleCopyMove = async () => {
    if (!copyMoveAction || !destDir.trim()) return;
    const { type, fileName } = copyMoveAction;
    setError('');
    setSuccessMessage('');
    try {
      const endpoint = type === 'copy' ? '/files/copy' : '/files/move';
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ dir: currentDir, file: fileName, destDir: destDir.trim() }),
      });
      if (res.errors?.length || res.code === 'CPANEL_DOWN') {
        setError(res.code === 'CPANEL_DOWN'
          ? pickErrorMessage(res, t, lang)
          : `${type === 'copy' ? 'Copy' : 'Move'} failed: ${res.errors[0]}`);
      } else {
        setSuccessMessage(`${fileName} ${type === 'copy' ? 'copied' : 'moved'} to ${destDir.trim()}`);
        setTimeout(() => setSuccessMessage(''), 5000);
        setCopyMoveAction(null);
        setDestDir('');
        fetchFiles(currentDir);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const dismissGuide = () => {
    setDismissedGuide(true);
    sessionStorage.setItem('panel_guide_dismissed', 'true');
  };

  const breadcrumbs = currentDir.split('/').filter(Boolean);
  const isTextFile = (name) => /\.(html?|css|js|json|xml|txt|php|py|md|htaccess|conf|log|yml|yaml|env|sh|sql|csv)$/i.test(name);
  const isArchive = (name) => /\.(zip|tar\.gz|tgz|tar\.bz2|gz|bz2|tar)$/i.test(name);
  const isWebFile = (name) => /\.(html?|php|htm)$/i.test(name);
  const isImage = (name) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name);

  // Visible (search-filtered) files
  const q = search.trim().toLowerCase();
  const visibleFiles = q
    ? files.filter(f => (f.file || '').toLowerCase().includes(q))
    : files;
  visibleFilesRef.current = visibleFiles;

  const toggleSelect = (name) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === visibleFiles.length && visibleFiles.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleFiles.map(f => f.file || f.fullpath?.split('/').pop()).filter(Boolean)));
    }
  };

  const allChecked = visibleFiles.length > 0 && selected.size === visibleFiles.length;
  const someChecked = selected.size > 0 && selected.size < visibleFiles.length;

  const headerCheckboxRef = useRef(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someChecked;
  }, [someChecked]);

  const performBulkDelete = async () => {
    if (!deleteTarget?.bulk) return;
    setDeleting(true);
    setError('');
    let okCount = 0;
    const failures = [];
    for (const item of deleteTarget.items) {
      try {
        const res = await api('/files/delete', {
          method: 'POST',
          body: JSON.stringify({ dir: currentDir, file: item.name, isDirectory: item.isDir }),
        });
        if (res && res.status === 0) {
          throw new Error(pickErrorMessage(res, t, lang) || res.error || 'Delete failed');
        }
        okCount++;
      } catch (err) {
        failures.push({ name: item.name, msg: err.message || 'Delete failed' });
      }
    }
    setDeleting(false);
    setDeleteTarget(null);
    setSelected(new Set());
    if (failures.length === 0) {
      setSuccessMessage(`${okCount} item${okCount === 1 ? '' : 's'} deleted.`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } else {
      setError(`${okCount}/${deleteTarget.items.length} deleted — ${failures.length} failed (first: ${failures[0].name}: ${failures[0].msg})`);
    }
    fetchFiles(currentDir);
  };

  const performBulkMove = async () => {
    if (!bulkMoveTarget?.destDir) return;
    const items = Array.from(selected);
    if (items.length === 0) { setBulkMoveTarget(null); return; }
    setError('');
    setSuccessMessage('');
    let okCount = 0;
    const failures = [];
    for (const name of items) {
      try {
        const res = await api('/files/move', {
          method: 'POST',
          body: JSON.stringify({ dir: currentDir, file: name, destDir: bulkMoveTarget.destDir.trim() }),
        });
        if (res.errors?.length || res.code === 'CPANEL_DOWN') {
          failures.push({ name, msg: pickErrorMessage(res, t, lang) || 'Move failed' });
        } else {
          okCount++;
        }
      } catch (err) {
        failures.push({ name, msg: err.message || 'Move failed' });
      }
    }
    setBulkMoveTarget(null);
    setSelected(new Set());
    if (failures.length === 0) {
      setSuccessMessage(`${okCount} item${okCount === 1 ? '' : 's'} moved to ${bulkMoveTarget.destDir.trim()}`);
      setTimeout(() => setSuccessMessage(''), 5000);
    } else {
      setError(`${okCount}/${items.length} moved — ${failures.length} failed (first: ${failures[0].name}: ${failures[0].msg})`);
    }
    fetchFiles(currentDir);
  };

  const handleBulkDelete = () => {
    const items = Array.from(selected).map(name => {
      const f = files.find(fl => (fl.file || fl.fullpath?.split('/').pop()) === name);
      return { name, isDir: f?.type === 'dir' };
    });
    if (items.length) setDeleteTarget({ bulk: true, items });
  };

  const handleBulkMove = () => {
    setBulkMoveTarget({ destDir: currentDir });
  };

  const openImagePreview = (name) => {
    const url = getPublicUrl(name, false);
    if (!url) return;
    setImagePreview({ name, url });
  };

  // Image gallery — list of all image files in current folder (sorted by name)
  const imageGallery = visibleFiles.filter(f => {
    const name = f.file || f.fullpath?.split('/').pop() || '';
    return f.type !== 'dir' && isImage(name);
  }).map(f => f.file || f.fullpath?.split('/').pop()).filter(Boolean);

  const galleryIndex = imagePreview ? imageGallery.indexOf(imagePreview.name) : -1;
  const hasPrev = galleryIndex > 0;
  const hasNext = galleryIndex >= 0 && galleryIndex < imageGallery.length - 1;

  const navGallery = (delta) => {
    if (!imagePreview || imageGallery.length === 0) return;
    const idx = galleryIndex + delta;
    if (idx < 0 || idx >= imageGallery.length) return;
    const name = imageGallery[idx];
    const url = getPublicUrl(name, false);
    if (url) setImagePreview({ name, url });
  };

  // Arrow-key navigation for image gallery
  useEffect(() => {
    if (!imagePreview) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); navGallery(-1); }
      else if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); navGallery(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePreview, galleryIndex, hasPrev, hasNext]);

  const getPublicUrl = (fileName, isDirectory) => {
    const publicHtmlIndex = currentDir.indexOf('/public_html');
    if (publicHtmlIndex === -1) return null;
    
    const relativePath = currentDir.substring(publicHtmlIndex + '/public_html'.length);
    const fullPath = relativePath ? `${relativePath}/${fileName}` : `/${fileName}`;
    
    const domain = user?.domain || 'yourdomain.com';
    const protocol = 'https://';
    
    if (isDirectory) {
      return `${protocol}${domain}${fullPath}/`;
    } else if (fileName === 'index.html' || fileName === 'index.php') {
      return `${protocol}${domain}${relativePath || '/'}`;
    } else {
      return `${protocol}${domain}${fullPath}`;
    }
  };

  const copyUrl = async (url, fileName) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(fileName);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      setError('Failed to copy URL');
    }
  };

  // Check if we should show the getting started guide
  const hasUserFiles = files.filter(f => {
    const name = f.file || '';
    return name !== 'cgi-bin' && name !== '.htaccess' && name !== '.user.ini' && name !== '.antired-challenge.php';
  }).length > 0;

  const showGettingStarted = isPublicHtmlRoot && !hasUserFiles && !dismissedGuide && !loading;

  return (
    <div 
      className="fm" 
      data-testid="file-manager"
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && <DragOverlay isPublicHtml={isPublicHtml} />}

      {/* Anti-Red protection status — hidden when 'active'; renders an inline
          card only when status === 'repairing' or 'stuck'. Backed by
          GET /panel/anti-red/status (polls every 30s) and the user-initiated
          POST /panel/anti-red/restore (1/min rate-limited). */}
      <AntiRedStatusCard />

      {/* Editor Modal */}
      {editingFile && (
        <div className="fm-modal-overlay" data-testid="fm-editor-modal">
          <div className="fm-modal">
            <div className="fm-modal-header">
              <span>{t('fm.editingFile', { name: editingFile })}</span>
              <button onClick={() => setEditingFile(null)} className="fm-modal-close">&times;</button>
            </div>
            <textarea
              className="fm-editor"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              data-testid="fm-editor-textarea"
              spellCheck={false}
            />
            <div className="fm-modal-actions">
              <button onClick={() => setEditingFile(null)} className="fm-btn fm-btn--ghost">{t('fm.cancel')}</button>
              <button onClick={handleSave} className="fm-btn fm-btn--primary" disabled={saving} data-testid="fm-editor-save">
                {saving ? t('fm.saving') : t('fm.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Location Banner - shows domain connection */}
      {isPublicHtml && (
        <div className="fm-location-banner" data-testid="fm-location-banner">
          <div className="fm-location-banner-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/>
            </svg>
          </div>
          <div className="fm-location-banner-text">
            <span className="fm-location-banner-label">{t('fm.websiteFolder')}</span>
            <span className="fm-location-banner-domain">
              {t('fm.filesLiveAt')} <a href={`https://${user?.domain}`} target="_blank" rel="noopener noreferrer">https://{user?.domain}</a>
            </span>
          </div>
        </div>
      )}

      {/* Getting Started Guide */}
      {showGettingStarted && (
        <div className="fm-getting-started" data-testid="fm-getting-started">
          <div className="fm-gs-header">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              {t('fm.getStarted.title')}
            </h3>
            <button onClick={dismissGuide} className="fm-gs-dismiss" title={t('fm.getStarted.dismissGuide')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <p
            className="fm-gs-subtitle"
            // i18n strings contain inline <strong> tags we want to render as real markup.
            dangerouslySetInnerHTML={{ __html: t('fm.getStarted.subtitle', { url: `https://${user?.domain}` }) }}
          />

          <div className="fm-gs-steps">
            <div className="fm-gs-step">
              <div className="fm-gs-step-num">1</div>
              <div className="fm-gs-step-content">
                <strong>{t('fm.getStarted.step1Title')}</strong>
                <p dangerouslySetInnerHTML={{ __html: t('fm.getStarted.step1Body') }} />
              </div>
            </div>
            <div className="fm-gs-step">
              <div className="fm-gs-step-num">2</div>
              <div className="fm-gs-step-content">
                <strong>{t('fm.getStarted.step2Title')}</strong>
                <p dangerouslySetInnerHTML={{ __html: t('fm.getStarted.step2Body') }} />
              </div>
            </div>
            <div className="fm-gs-step">
              <div className="fm-gs-step-num">3</div>
              <div className="fm-gs-step-content">
                <strong>{t('fm.getStarted.step3Title')}</strong>
                <p>
                  {t('fm.getStarted.step3Body', { url: '' }).replace(/\s*$/, '')}{' '}
                  <a href={`https://${user?.domain}`} target="_blank" rel="noopener noreferrer">https://{user?.domain}</a>
                </p>
              </div>
            </div>
          </div>

          <div className="fm-gs-tips">
            <div className="fm-gs-tip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 2v6h6V2"/><path d="M12 8v4"/><path d="M9 12h6"/></svg>
              <span dangerouslySetInnerHTML={{ __html: t('fm.getStarted.proTip') }} />
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <Toolbar
        homeUsername={user?.username}
        breadcrumbs={breadcrumbs}
        onCrumbClick={setCurrentDir}
        searchRef={searchRef}
        search={search}
        onSearchChange={setSearch}
        onGoUp={goUp}
        onToggleNewDir={() => setShowNewDir(!showNewDir)}
        uploading={uploading}
        fileInputRef={fileInputRef}
        folderInputRef={folderInputRef}
        onUpload={handleUpload}
      />

      {/* Bulk action bar (shows when items selected) */}
      <BulkBar
        count={selected.size}
        onMove={handleBulkMove}
        onDelete={handleBulkDelete}
        onClear={() => setSelected(new Set())}
      />

      {/* Upload progress — includes elapsed timer and a "still working" warning
          after 30s so users on slow cPanel responses don't think the tab froze. */}
      {uploadProgress && (
        <div className="fm-upload-progress" data-testid="fm-upload-progress">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="fm-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          <span>
            {uploadProgress}
            {uploadElapsed > 0 && (
              <span className="fm-upload-elapsed" data-testid="fm-upload-elapsed"> · {Math.floor(uploadElapsed / 60)}:{String(uploadElapsed % 60).padStart(2, '0')}</span>
            )}
          </span>
        </div>
      )}
      {uploading && uploadElapsed >= 30 && (
        <div className="fm-upload-slow" data-testid="fm-upload-slow" style={{
          padding: '0.6rem 0.85rem', margin: '0.35rem 0 0',
          borderRadius: 10, fontSize: '0.82rem', lineHeight: 1.45,
          background: 'rgba(225, 29, 72, 0.06)', color: 'var(--fm-muted, #6b7280)',
          border: '1px solid rgba(225, 29, 72, 0.18)',
        }}>
          {t('errors.uploadSlow')}
        </div>
      )}

      {/* New Directory Input */}
      {showNewDir && (
        <div className="fm-new-dir" data-testid="fm-new-dir-form">
          <input
            type="text"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            placeholder={t('fm.folderNamePlaceholder')}
            data-testid="fm-new-dir-input"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateDir()}
          />
          <button onClick={handleCreateDir} className="fm-btn fm-btn--primary" data-testid="fm-new-dir-create">{t('fm.create')}</button>
          <button onClick={() => { setShowNewDir(false); setNewDirName(''); }} className="fm-btn fm-btn--ghost">{t('fm.cancel')}</button>
        </div>
      )}

      {error && (
        <div className="fm-error" data-testid="fm-error">
          <span>{error}</span>
          {/* Offer a Retry button when the error looks transient (timeout /
              unreachable) and the file list is empty — this is the exact
              "error after login" post-login state @ciroovblzz reported. One
              tap refetches without forcing a full page reload. */}
          {!loading && files.length === 0 && isTransientError(errorRaw) && (
            <button
              type="button"
              className="fm-btn fm-btn--ghost"
              onClick={() => fetchFiles(currentDir)}
              data-testid="fm-error-retry"
              style={{ marginLeft: '0.75rem' }}
            >
              {t('errors.retry')}
            </button>
          )}
        </div>
      )}
      
      {successMessage && (
        <div className="fm-success" data-testid="fm-success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Inline upload tip when folder has few files but not empty */}
      {!loading && !showGettingStarted && isPublicHtmlRoot && files.length <= 3 && !error && !successMessage && (
        <div className="fm-tip" data-testid="fm-bulk-tip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span dangerouslySetInnerHTML={{ __html: t('fm.bulkTip', { url: `https://${user?.domain}` }) }} />
        </div>
      )}

      {/* File List */}
      <div className="fm-list" data-testid="fm-file-list">
        {loading ? (
          <div className="fm-loading">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="fm-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
            <span>{t('fm.loading')}</span>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="fm-empty" data-testid="fm-empty-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{opacity: 0.4}}>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            <p>{search ? t('fm.emptySearch', { query: search }) : t('fm.emptyFolder')}</p>
            {!search && isPublicHtml && <span>{t('fm.emptyUploadHint')}</span>}
            {search && <span dangerouslySetInnerHTML={{ __html: t('fm.searchTryAgain') }} />}
          </div>
        ) : (
          <>
            {/* Desktop: Table view */}
            <table className="fm-table fm-table--desktop">
              <thead>
                <tr>
                  <th className="fm-cell-select">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      className="fm-checkbox"
                      checked={allChecked}
                      onChange={toggleSelectAll}
                      data-testid="fm-select-all"
                      aria-label={t('fm.selectAll')}
                    />
                  </th>
                  <th>{t('fm.table.name')}</th>
                  <th>{t('fm.table.publicUrl')}</th>
                  <th>{t('fm.table.size')}</th>
                  <th>{t('fm.table.modified')}</th>
                  <th>{t('fm.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleFiles.map((f, i) => {
                  const name = f.file || f.fullpath?.split('/').pop() || 'unknown';
                  const isDir = f.type === 'dir';
                  const size = isDir ? '-' : formatSize(f.size || f.rawsize || 0);
                  const modified = f.mtime ? new Date(f.mtime * 1000).toLocaleDateString() : '-';
                  const publicUrl = getPublicUrl(name, isDir);
                  const isSelected = selected.has(name);
                  const isImg = !isDir && isImage(name);

                  return (
                    <tr key={i} data-testid={`fm-row-${name}`} className={isSelected ? 'fm-row--selected' : ''}>
                      <td className="fm-cell-select">
                        <input
                          type="checkbox"
                          className="fm-checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(name)}
                          data-testid={`fm-select-${name}`}
                          aria-label={t('fm.selectOne', { name })}
                        />
                      </td>
                      <td>
                        {isDir ? (
                          <button className="fm-file-link fm-file-link--dir" onClick={() => navigate(name)} data-testid={`fm-nav-${name}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                            {name}
                          </button>
                        ) : isImg && publicUrl ? (
                          <button className="fm-file-link" onClick={() => openImagePreview(name)} data-testid={`fm-img-preview-${name}`} title={t('fm.clickToPreview')}>
                            <img className="fm-thumb" src={publicUrl} alt={name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                            {name}
                          </button>
                        ) : (
                          <span className="fm-file-name">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            {name}
                          </span>
                        )}
                      </td>
                      <td className="fm-cell-url">
                        {publicUrl ? (
                          <a 
                            href={publicUrl} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="fm-url-link"
                            title={publicUrl}
                            data-testid={`fm-url-${name}`}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            {publicUrl.replace(/^https?:\/\//, '').substring(0, 40)}
                            {publicUrl.length > 50 ? '...' : ''}
                          </a>
                        ) : (
                          <span className="fm-url-none">-</span>
                        )}
                      </td>
                      <td className="fm-cell-size">{size}</td>
                      <td className="fm-cell-date">{modified}</td>
                      <td className="fm-cell-actions">
                        {publicUrl && (
                          <>
                            <button 
                              onClick={() => copyUrl(publicUrl, name)} 
                              className={`fm-action-btn ${copiedUrl === name ? 'fm-action-btn--success' : ''}`}
                              title={copiedUrl === name ? t('fm.actions.copied') : t('fm.actions.copyUrl')}
                              data-testid={`fm-copy-${name}`}
                            >
                              {copiedUrl === name ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                              )}
                            </button>
                            {!isDir && isWebFile(name) && (
                              <a 
                                href={publicUrl} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="fm-action-btn fm-action-btn--view"
                                title={t('fm.actions.openInBrowser')}
                                data-testid={`fm-view-${name}`}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              </a>
                            )}
                          </>
                        )}
                        {!isDir && isTextFile(name) && (
                          <button onClick={() => handleEdit(name)} className="fm-action-btn" title={t('fm.actions.edit')} data-testid={`fm-edit-${name}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                        )}
                        {!isDir && isArchive(name) && (
                          <button
                            onClick={() => handleExtract(name)}
                            className={`fm-action-btn fm-action-btn--extract ${extracting === name ? 'fm-action-btn--spinning' : ''}`}
                            title={t('fm.actions.extract')}
                            data-testid={`fm-extract-${name}`}
                            disabled={!!extracting}
                          >
                            {extracting === name ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="fm-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 2v6h6V2"/><path d="M12 8v4"/><path d="M9 12h6"/></svg>
                            )}
                          </button>
                        )}
                        <button onClick={() => { setRenaming(name); setRenameValue(name); }} className="fm-action-btn" title={t('fm.actions.rename')} data-testid={`fm-rename-${name}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button onClick={() => openCopyMove('copy', name)} className="fm-action-btn" title={t('fm.actions.copyTo')} data-testid={`fm-copy-file-${name}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        </button>
                        <button onClick={() => openCopyMove('move', name)} className="fm-action-btn" title={t('fm.actions.moveTo')} data-testid={`fm-move-file-${name}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        </button>
                        <button onClick={() => handleDelete(name, isDir)} className="fm-action-btn fm-action-btn--danger" title={t('fm.actions.delete')} data-testid={`fm-delete-${name}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile: Card view */}
            <div className="fm-cards fm-cards--mobile">
              {visibleFiles.map((f, i) => {
                const name = f.file || f.fullpath?.split('/').pop() || 'unknown';
                const isDir = f.type === 'dir';
                const size = isDir ? '-' : formatSize(f.size || f.rawsize || 0);
                const modified = f.mtime ? new Date(f.mtime * 1000).toLocaleDateString() : '-';
                const publicUrl = getPublicUrl(name, isDir);
                const isSelected = selected.has(name);

                return (
                  <div key={i} className={`fm-card ${isSelected ? 'fm-row--selected' : ''}`} data-testid={`fm-card-${name}`}>
                    <div className="fm-card-main">
                      <input
                        type="checkbox"
                        className="fm-checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(name)}
                        data-testid={`fm-select-mobile-${name}`}
                        aria-label={t('fm.selectOne', { name })}
                        onClick={(e) => e.stopPropagation()}
                        style={{ marginRight: 4 }}
                      />
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: isDir ? 'pointer' : 'default' }}
                        onClick={isDir ? () => navigate(name) : undefined}
                      >
                        <div className={`fm-card-icon ${isDir ? 'fm-card-icon--dir' : isArchive(name) ? 'fm-card-icon--zip' : ''}`}>
                          {isDir ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                          ) : isArchive(name) ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 2v6h6V2"/><path d="M12 8v4"/><path d="M9 12h6"/></svg>
                          ) : isImage(name) && publicUrl ? (
                            <img className="fm-thumb" style={{ width: 28, height: 28 }} src={publicUrl} alt={name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                          ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          )}
                        </div>
                        <div className="fm-card-info">
                          <span className={`fm-card-name ${isDir ? 'fm-card-name--dir' : ''}`}>{name}</span>
                          <span className="fm-card-meta">{size} &middot; {modified}</span>
                          {publicUrl && (
                            <a 
                              href={publicUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="fm-card-url"
                              title={publicUrl}
                              data-testid={`fm-url-mobile-${name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              {publicUrl.replace(/^https?:\/\//, '').substring(0, 35)}
                              {publicUrl.length > 45 ? '...' : ''}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="fm-card-actions">
                      {publicUrl && (
                        <>
                          <button 
                            onClick={() => copyUrl(publicUrl, name)} 
                            className={`fm-action-chip ${copiedUrl === name ? 'fm-action-chip--success' : ''}`}
                            data-testid={`fm-copy-mobile-${name}`}
                          >
                            {copiedUrl === name ? (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                            ) : (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                            )}
                            <span>{copiedUrl === name ? t('fm.actions.copied') : t('fm.actions.copyUrl')}</span>
                          </button>
                          {!isDir && isWebFile(name) && (
                            <a 
                              href={publicUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="fm-action-chip fm-action-chip--view"
                              data-testid={`fm-view-mobile-${name}`}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                              <span>{t('fm.actions.view')}</span>
                            </a>
                          )}
                        </>
                      )}
                      {!isDir && isArchive(name) && (
                        <button
                          onClick={() => handleExtract(name)}
                          className={`fm-action-chip fm-action-chip--extract ${extracting === name ? 'fm-action-chip--spinning' : ''}`}
                          data-testid={`fm-extract-mobile-${name}`}
                          disabled={!!extracting}
                        >
                          {extracting === name ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="fm-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M9 2v6h6V2"/><path d="M12 8v4"/><path d="M9 12h6"/></svg>
                          )}
                          <span>{t('files.extract')}</span>
                        </button>
                      )}
                      {!isDir && isTextFile(name) && (
                        <button onClick={() => handleEdit(name)} className="fm-action-chip" data-testid={`fm-edit-mobile-${name}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          <span>{t('fm.actions.edit')}</span>
                        </button>
                      )}
                      <button onClick={() => { setRenaming(name); setRenameValue(name); }} className="fm-action-chip" data-testid={`fm-rename-mobile-${name}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        <span>{t('fm.actions.rename')}</span>
                      </button>
                      <button onClick={() => openCopyMove('copy', name)} className="fm-action-chip" data-testid={`fm-copy-file-mobile-${name}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        <span>{t('fm.actions.copy')}</span>
                      </button>
                      <button onClick={() => openCopyMove('move', name)} className="fm-action-chip" data-testid={`fm-move-file-mobile-${name}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        <span>{t('fm.actions.move')}</span>
                      </button>
                      <button onClick={() => handleDelete(name, isDir)} className="fm-action-chip fm-action-chip--danger" data-testid={`fm-delete-mobile-${name}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        <span>{t('fm.actions.delete')}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Rename Modal */}
      {renaming && (
        <div className="fm-modal-overlay" data-testid="fm-rename-modal">
          <div className="fm-modal fm-modal--sm">
            <div className="fm-modal-header">
              <span>{t('fm.rename.title', { name: renaming })}</span>
              <button onClick={() => setRenaming(null)} className="fm-modal-close">&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <input
                type="text"
                className="fm-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRename(renaming)}
                data-testid="fm-rename-input"
                autoFocus
              />
            </div>
            <div className="fm-modal-actions">
              <button onClick={() => setRenaming(null)} className="fm-btn fm-btn--ghost">{t('fm.cancel')}</button>
              <button onClick={() => handleRename(renaming)} className="fm-btn fm-btn--primary" data-testid="fm-rename-submit">{t('fm.rename.submit')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Copy/Move Modal */}
      {copyMoveAction && (
        <div className="fm-modal-overlay" data-testid="fm-copymove-modal">
          <div className="fm-modal fm-modal--sm">
            <div className="fm-modal-header">
              <span>
                {t(copyMoveAction.type === 'copy' ? 'fm.copymove.copyTitle' : 'fm.copymove.moveTitle', { name: copyMoveAction.fileName })}
              </span>
              <button onClick={() => setCopyMoveAction(null)} className="fm-modal-close">&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#94a3b8' }}>
                {t('fm.copymove.destinationLabel')}
              </label>
              <input
                type="text"
                className="fm-rename-input"
                value={destDir}
                onChange={(e) => setDestDir(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCopyMove()}
                placeholder={`/home/${user?.username}/public_html`}
                data-testid="fm-copymove-input"
                autoFocus
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                {t('fm.copymove.hint', { action: t(copyMoveAction.type === 'copy' ? 'fm.copymove.copy' : 'fm.copymove.move').toLowerCase() })}
              </div>
            </div>
            <div className="fm-modal-actions">
              <button onClick={() => setCopyMoveAction(null)} className="fm-btn fm-btn--ghost">{t('fm.cancel')}</button>
              <button onClick={handleCopyMove} className="fm-btn fm-btn--primary" data-testid="fm-copymove-submit">
                {t(copyMoveAction.type === 'copy' ? 'fm.copymove.copy' : 'fm.copymove.move')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fm-modal-overlay" data-testid="fm-delete-modal">
          <div className="fm-modal fm-modal--sm">
            <div className="fm-modal-header">
              <span>
                {deleteTarget.bulk
                  ? t(deleteTarget.items.length === 1 ? 'fm.delete.bulkTitleOne' : 'fm.delete.bulkTitle', { count: deleteTarget.items.length })
                  : t(deleteTarget.isDir ? 'fm.delete.folderTitle' : 'fm.delete.fileTitle')}
              </span>
              <button onClick={() => !deleting && setDeleteTarget(null)} className="fm-modal-close" data-testid="fm-delete-close">&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {deleteTarget.bulk ? (
                <>
                  <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 12, maxHeight: 160, overflowY: 'auto' }} data-testid="fm-bulk-delete-list">
                    {deleteTarget.items.slice(0, 12).map((it, idx) => (
                      <div key={idx} style={{ padding: '4px 0', wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                        {it.isDir ? '📁 ' : '📄 '}{it.name}
                      </div>
                    ))}
                    {deleteTarget.items.length > 12 && (
                      <div style={{ padding: '4px 0', color: 'var(--pv-text-muted)', fontSize: 12 }}>
                        {t('fm.delete.bulkMore', { count: deleteTarget.items.length - 12 })}
                      </div>
                    )}
                  </div>
                  {deleteTarget.items.some(it => it.isDir) && (
                    <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 8 }}>
                      {t('fm.delete.folderWarning')}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, color: '#e2e8f0', wordBreak: 'break-all', marginBottom: 12 }} data-testid="fm-delete-target-name">
                    {deleteTarget.fileName}
                  </div>
                  {deleteTarget.isDir && (
                    <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 8 }}>
                      {t('fm.delete.singleFolderWarning')}
                    </div>
                  )}
                </>
              )}
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {t('fm.delete.cannotUndo')}
              </div>
            </div>
            <div className="fm-modal-actions">
              <button
                onClick={() => setDeleteTarget(null)}
                className="fm-btn fm-btn--ghost"
                disabled={deleting}
                data-testid="fm-delete-cancel"
              >
                {t('fm.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                className="fm-btn fm-btn--primary"
                disabled={deleting}
                data-testid="fm-delete-confirm"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
              >
                {deleting ? t('fm.delete.deleting') : t('fm.actions.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Move Modal */}
      {bulkMoveTarget && (
        <div className="fm-modal-overlay" data-testid="fm-bulk-move-modal">
          <div className="fm-modal fm-modal--sm">
            <div className="fm-modal-header">
              <span>
                {t(selected.size === 1 ? 'fm.bulkMove.titleOne' : 'fm.bulkMove.title', { count: selected.size })}
              </span>
              <button onClick={() => setBulkMoveTarget(null)} className="fm-modal-close">&times;</button>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--pv-text-secondary)' }}>
                {t('fm.bulkMove.destinationLabel')}
              </label>
              <input
                type="text"
                className="fm-rename-input"
                value={bulkMoveTarget.destDir}
                onChange={(e) => setBulkMoveTarget({ ...bulkMoveTarget, destDir: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && performBulkMove()}
                placeholder={`/home/${user?.username}/public_html`}
                data-testid="fm-bulk-move-input"
                autoFocus
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pv-text-muted)' }}>
                {t('fm.bulkMove.hint')}
              </div>
            </div>
            <div className="fm-modal-actions">
              <button onClick={() => setBulkMoveTarget(null)} className="fm-btn fm-btn--ghost">{t('fm.cancel')}</button>
              <button onClick={performBulkMove} className="fm-btn fm-btn--primary" data-testid="fm-bulk-move-submit">
                {t('fm.bulkMove.submit', { count: selected.size })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      <ImagePreviewModal
        preview={imagePreview}
        galleryLength={imageGallery.length}
        galleryIndex={galleryIndex}
        hasPrev={hasPrev}
        hasNext={hasNext}
        onNav={navGallery}
        onClose={() => setImagePreview(null)}
      />
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
