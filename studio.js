(function () {
  'use strict';
  const api = window.portfolioContent;
  const $ = id => document.getElementById(id);
  const preview = $('preview');
  const sessionKey = 'pranay-portfolio-studio-session';
  let session;
  let documents = {};
  let working;
  let saved;
  let publishedSnapshot;
  let active = api.groups[0].id;
  let busy = false;
  let previewTimer;
  let noticeTimer;

  function element(tag, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function notify(message) {
    clearTimeout(noticeTimer);
    $('notice').textContent = message;
    $('notice').hidden = false;
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
  }

  function remember(value) {
    session = value;
    try {
      if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
      else sessionStorage.removeItem(sessionKey);
    } catch {
      // The current page can still sign in when session storage is unavailable.
    }
  }

  async function token() {
    if (!session) throw new Error('Sign in to continue.');
    if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
    const refreshed = await api.request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: session.refresh_token }
    });
    remember(refreshed);
    return refreshed.access_token;
  }

  function updateStatus() {
    const changed = working && JSON.stringify(working) !== JSON.stringify(saved);
    const pending = working && JSON.stringify(working) !== JSON.stringify(publishedSnapshot);
    $('change-state').textContent = changed ? 'Unsaved changes' : pending ? 'Draft saved' : 'Published';
    $('save-draft').disabled = busy || !working || !changed;
    $('publish').disabled = busy || !working || !pending;
    $('sign-out').disabled = busy;
  }

  function editable(studio) {
    return studio?.version === 1 ? { version: 1, fields: studio.fields, lists: studio.lists } : null;
  }

  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (working) preview.contentWindow?.portfolioPage?.apply(working);
    }, 120);
    updateStatus();
  }

  function previewSection() {
    const frame = preview.contentWindow;
    const target = preview.contentDocument?.getElementById(active);
    if (target) frame.scrollTo({ top: frame.scrollY + target.getBoundingClientRect().top - 72, behavior: 'instant' });
  }

  function readPreview() {
    return new Promise((resolve, reject) => {
      preview.addEventListener('load', () => {
        const page = preview.contentWindow?.portfolioPage;
        if (page) resolve(page.baseline());
        else reject(new Error('The portfolio preview could not load. Refresh the studio and try again.'));
      }, { once: true });
      preview.src = '/?studio-preview=1';
    });
  }

  async function openWorkspace() {
    const access = await token();
    const membership = await api.request('/rest/v1/portfolio_admins?select=user_id&limit=1', { token: access });
    if (!membership?.length) throw new Error('This account does not have access to edit the portfolio.');
    const [draft, published, baseline] = await Promise.all([api.read('draft', access), api.read('published', access), readPreview()]);
    if (!draft || !published) throw new Error('The portfolio content records could not be loaded.');
    documents = { draft, published };
    const latest = (draft.studio?.savedAt || '') > (published.studio?.savedAt || '') ? draft.studio : published.studio;
    const previous = editable(latest);
    function withDefaults(content) {
      return { version: 1, fields: { ...baseline.fields, ...content?.fields }, lists: { ...baseline.lists, ...content?.lists } };
    }
    publishedSnapshot = withDefaults(editable(published.studio));
    working = withDefaults(previous);
    saved = structuredClone(working);
    $('workspace').hidden = false;
    $('sign-out').hidden = false;
    $('login').hidden = true;
    render();
    updatePreview();
  }

  function parseLines(value) {
    return value.split('\n').map(line => line.trim()).filter(Boolean);
  }

  function fieldControl(field, data, onChange = () => {}) {
    const label = element('label', field.label);
    const isList = ['lines', 'bullets', 'metrics'].includes(field.type);
    const multiline = isList || ['long', 'headline'].includes(field.type);
    const input = element(field.type === 'category' ? 'select' : multiline ? 'textarea' : 'input');
    if (field.type === 'category') {
      for (const [value, name] of [['aiml', 'GenAI and ML'], ['bi', 'BI and FinOps']]) {
        const option = element('option', name);
        option.value = value;
        input.append(option);
      }
    } else if (input.tagName === 'INPUT') {
      input.type = ['email', 'tel'].includes(field.type) ? field.type : 'text';
      if (['link', 'image'].includes(field.type)) input.inputMode = 'url';
    }

    const value = data[field.key];
    if (field.type === 'metrics') input.value = (value || []).map(metric => metric.val + ' | ' + metric.lbl).join('\n');
    else if (isList) input.value = (value || []).join('\n');
    else input.value = value || (field.type === 'category' ? 'aiml' : '');
    if (field.type === 'headline') input.placeholder = 'Use a new line for each line of the headline';
    if (isList) input.placeholder = field.type === 'metrics' ? 'One metric per line, for example 98% | Accuracy' : 'One item per line';
    if (field.type === 'link') input.placeholder = 'https://';

    function changed() {
      if (field.type === 'metrics') {
        const previous = data[field.key] || [];
        data[field.key] = parseLines(input.value).map((line, index) => {
          const [val, ...labelParts] = line.split('|');
          return { val: val.trim(), lbl: labelParts.join('|').trim(), accent: previous[index]?.accent ?? index === 0 };
        });
      } else if (isList) {
        data[field.key] = parseLines(input.value);
      } else {
        data[field.key] = input.value;
      }
      onChange();
      updatePreview();
    }
    input.addEventListener('input', changed);
    label.append(input);

    if (field.type !== 'image') return label;
    const imageControl = element('div', '', 'image-controls');
    const fileLabel = element('label', 'Upload image');
    const fileInput = element('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileLabel.append(fileInput);
    imageControl.append(label, fileLabel, element('small', 'Uploads use public image URLs. Maximum 5 MB.'));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file || busy) return;
      busy = true;
      fileInput.disabled = true;
      updateStatus();
      try {
        input.value = await api.upload(file, await token());
        changed();
        notify('Image uploaded. Save the draft or publish to keep this selection.');
      } catch (error) {
        notify(error.message);
      } finally {
        busy = false;
        fileInput.value = '';
        fileInput.disabled = false;
        updateStatus();
      }
    });
    return imageControl;
  }

  function action(label, handler, disabled = false) {
    const button = element('button', label, 'quiet');
    button.type = 'button';
    button.disabled = disabled;
    button.addEventListener('click', handler);
    return button;
  }

  function listControl(list) {
    const section = element('section', '', 'entry-list');
    section.append(element('h2', list.label));
    const entries = working.lists[list.key];
    const cards = element('div');
    let openId;

    function draw() {
      cards.replaceChildren();
      entries.forEach((entry, index) => {
        const item = element('details', '', 'entry');
        const summary = element('summary');
        function updateLabel() {
          summary.textContent = (entry.title || 'Untitled ' + list.singular) + (entry.visible === false ? ' (hidden)' : '');
        }
        updateLabel();
        item.open = entry.id === openId;
        const fields = element('div', '', 'fields');
        const visible = element('label', '', 'check');
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = entry.visible !== false;
        checkbox.addEventListener('change', () => {
          entry.visible = checkbox.checked;
          updateLabel();
          updatePreview();
        });
        visible.append(checkbox, document.createTextNode('Show on portfolio'));
        fields.append(visible, ...list.fields.map(field => fieldControl(field, entry, updateLabel)));
        const tools = element('div', '', 'entry-tools');
        function move(to) {
          entries.splice(index, 1);
          entries.splice(to, 0, entry);
          openId = entry.id;
          draw();
          cards.querySelector('[open] summary')?.focus();
          updatePreview();
        }
        tools.append(action('Move up', () => move(index - 1), index === 0));
        tools.append(action('Move down', () => move(index + 1), index === entries.length - 1));
        tools.append(action('Remove', () => {
          if (!window.confirm('Remove this entry from the current edit?')) return;
          entries.splice(index, 1);
          draw();
          add.focus();
          updatePreview();
        }));
        fields.append(tools);
        item.append(summary, fields);
        cards.append(item);
      });
    }

    const add = action('Add ' + list.singular, () => {
      const entry = { id: crypto.randomUUID(), visible: true };
      for (const field of list.fields) {
        entry[field.key] = ['lines', 'bullets', 'metrics'].includes(field.type) ? [] : '';
      }
      if (list.key === 'projects') entry.group = 'aiml';
      entries.push(entry);
      openId = entry.id;
      draw();
      cards.querySelector('[open] summary')?.focus();
      updatePreview();
    });
    draw();
    section.append(cards, add);
    return section;
  }

  function render(focusTitle = false) {
    const group = api.groups.find(group => group.id === active);
    $('sections').replaceChildren(...api.groups.map(item => {
      const button = action(item.title, () => {
        active = item.id;
        render(true);
        previewSection();
      });
      if (item.id === active) button.setAttribute('aria-current', 'true');
      return button;
    }));
    const title = $('editor-title');
    title.textContent = group.title;
    if (focusTitle) {
      title.tabIndex = -1;
      title.focus();
    }
    const fields = element('div', '', 'fields');
    fields.append(...group.fields.map(field => fieldControl(field, working.fields)));
    $('editor-body').replaceChildren(fields, ...api.lists.filter(list => list.group === active).map(listControl));
  }

  function validate(studio) {
    for (const group of api.groups) {
      for (const field of group.fields) validateField(field, studio.fields[field.key]);
    }
    for (const list of api.lists) {
      for (const entry of studio.lists[list.key]) {
        if (entry.visible !== false && !entry.title?.trim()) throw new Error('Add a title for every visible ' + list.singular + '.');
        for (const field of list.fields) validateField(field, entry[field.key]);
      }
    }
  }

  function validateField(field, value) {
    if (value && ['link', 'image'].includes(field.type) && !api.safeUrl(value, field.type === 'image')) {
      throw new Error(field.label + ' needs a valid HTTPS URL' + (field.type === 'image' ? ' or a site image path.' : '.'));
    }
  }

  async function save(kind) {
    if (busy || !working) return;
    const snapshot = structuredClone(working);
    busy = true;
    updateStatus();
    try {
      if (kind === 'published') validate(snapshot);
      const studio = { ...snapshot, revision: crypto.randomUUID(), savedAt: new Date().toISOString() };
      documents[kind] = await api.save(kind, documents[kind], studio, await token());
      if (kind === 'published') publishedSnapshot = snapshot;
      saved = snapshot;
      notify(kind === 'draft' ? 'Draft saved.' : 'Published. Refresh the public portfolio to see your changes.');
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      updateStatus();
    }
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const values = new FormData(form);
    button.disabled = true;
    try {
      const signedIn = await api.request('/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: values.get('email').trim(), password: values.get('password') }
      });
      remember(signedIn);
      form.reset();
      await openWorkspace();
    } catch (error) {
      remember(null);
      notify(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $('save-draft').addEventListener('click', () => save('draft'));
  $('publish').addEventListener('click', () => save('published'));
  $('sign-out').addEventListener('click', async () => {
    if (JSON.stringify(working) !== JSON.stringify(saved) && !window.confirm('Sign out and discard unsaved changes?')) return;
    try {
      await api.request('/auth/v1/logout?scope=local', { method: 'POST', token: await token() });
    } catch {
      // Clear the session on this device even if the remote request fails.
    }
    remember(null);
    location.reload();
  });
  window.addEventListener('beforeunload', event => {
    if (!working || JSON.stringify(working) === JSON.stringify(saved)) return;
    event.preventDefault();
    event.returnValue = true;
  });

  try { session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
  if (session) {
    openWorkspace().catch(error => {
      remember(null);
      notify(error.message);
    });
  }
})();
