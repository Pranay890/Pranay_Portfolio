(function () {
  'use strict';
  const { groups, lists, read, safeUrl } = window.portfolioContent;
  const fields = groups.flatMap(group => group.fields);
  const collections = lists.filter(list => list.root).map(list => {
    const root = document.querySelector(list.root);
    const originals = [...root.querySelectorAll(list.item)];
    return { ...list, root, originals, templates: originals.map(node => node.cloneNode(true)) };
  });

  function readField(root, field) {
    const element = root.querySelector(field.selector);
    if (field.type === 'headline') return [...element.querySelectorAll('.mask-inner')].map(line => line.textContent.trim()).join('\n');
    if (field.type === 'lines') return [...element.querySelectorAll('.tag')].map(tag => tag.textContent.trim());
    if (field.type === 'bullets') return [...element.querySelectorAll('li')].map(item => item.textContent.trim());
    if (field.type === 'metrics') return [...element.querySelectorAll('.sig-item')].map(item => ({
      val: item.querySelector('.sig-val').textContent.trim(),
      lbl: item.querySelector('.sig-lbl').textContent.trim(),
      accent: item.querySelector('.sig-val').classList.contains('is-accent')
    }));
    return field.attr ? element?.getAttribute(field.attr) || '' : element?.textContent.trim() || '';
  }

  const baseline = { fields: {}, lists: { projects: window.portfolioProjects.read() } };
  for (const field of fields) baseline.fields[field.key] = readField(document, field);
  for (const list of collections) {
    baseline.lists[list.key] = list.originals.map((item, index) => ({
      id: list.key + '-' + index, template: index, visible: true,
      ...Object.fromEntries(list.fields.map(field => [field.key, readField(item, field)]))
    }));
  }
  if (new URLSearchParams(location.search).has('studio-preview')) {
    document.head.append(Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' }));
  }

  function node(tag, className, text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function writeField(root, field, value, original) {
    const element = root.querySelector(field.selector);
    if (!element || JSON.stringify(value) === JSON.stringify(original)) return;
    if (field.type === 'headline') {
      const lines = String(value || '').split('\n').filter(Boolean);
      element.replaceChildren(...lines.map(line => {
        const frame = node('span', 'mask-line');
        frame.append(node('span', 'mask-inner', line));
        return frame;
      }));
    } else if (field.type === 'lines') {
      element.replaceChildren(...value.map(text => node('span', 'tag', text)));
    } else if (field.type === 'bullets') {
      element.replaceChildren(node('div', 'exp-spine studio-spine'), ...value.map(text => node('li', 'exp-bullet', text)));
    } else if (field.type === 'metrics') {
      element.replaceChildren(...value.map(metric => {
        const item = node('div', 'sig-item');
        item.append(node('span', metric.accent ? 'sig-val is-accent' : 'sig-val', metric.val), node('span', 'sig-lbl', metric.lbl));
        return item;
      }));
      element.hidden = !value.length;
    } else if (field.attr) {
      const attrValue = field.type === 'image' || field.type === 'link' ? safeUrl(value, field.type === 'image') : value;
      if (attrValue) element.setAttribute(field.attr, attrValue);
      else element.removeAttribute(field.attr);
    } else {
      element.textContent = value ?? '';
    }
  }

  function buildAiCard(card, entry) {
    const imageFrame = card.querySelector('.ai-build-visual');
    const image = imageFrame.querySelector('img');
    const imageUrl = safeUrl(entry.image, true);
    imageFrame.hidden = !imageUrl;
    if (imageUrl) image.src = imageUrl;
    image.alt = entry.alt || '';

    const actions = card.querySelector('.ai-build-actions');
    const liveUrl = safeUrl(entry.live);
    const repoUrl = safeUrl(entry.github);
    actions.replaceChildren();
    for (const [url, style, label] of [
      [liveUrl, 'btn-primary', 'Open live app'],
      [repoUrl, liveUrl ? 'link-muted' : 'btn-secondary', liveUrl ? 'Source code' : 'View on GitHub']
    ]) {
      if (!url) continue;
      const link = node('a', style, label);
      Object.assign(link, { href: url, target: '_blank', rel: 'noopener noreferrer' });
      link.setAttribute('aria-label', label + ' for ' + entry.title);
      actions.append(link);
    }
    actions.hidden = !actions.childElementCount;
  }

  function renderList(list, entries) {
    const before = baseline.lists[list.key];
    const newItems = entries.filter(entry => entry.visible !== false).map((entry, index) => {
      const original = before.find(record => record.id === entry.id);
      const templateIndex = Number.isInteger(entry.template) && list.templates[entry.template] ? entry.template : 0;
      if (original && list.originals[templateIndex] && list.key !== 'education' &&
          JSON.stringify({ ...entry, visible: true }) === JSON.stringify(original)) {
        return list.originals[templateIndex];
      }
      const item = list.templates[templateIndex].cloneNode(true);
      item.classList.remove('reveal');
      item.removeAttribute('aria-labelledby');
      for (const element of item.querySelectorAll('[id]')) element.removeAttribute('id');
      for (const field of list.fields) {
        if (list.key === 'aiBuilds' && ['image', 'alt', 'github', 'live'].includes(field.key)) continue;
        writeField(item, field, entry[field.key], before[templateIndex]?.[field.key]);
      }
      if (list.key === 'aiBuilds') buildAiCard(item, entry);
      if (list.key === 'experience') {
        item.querySelector('.exp-spine')?.classList.add('studio-spine');
        item.classList.add('studio-role');
      }
      if (list.key === 'education') {
        item.removeAttribute('style');
        item.classList.toggle('studio-education-divider', index > 0);
      }
      return item;
    });
    for (const item of list.root.querySelectorAll(list.item)) item.remove();
    list.root.append(...newItems);
  }

  let current = structuredClone(baseline);
  function apply(data) {
    if (!data || data.version !== 1 || !data.fields || !data.lists) return;
    for (const field of fields) {
      const value = data.fields[field.key] ?? baseline.fields[field.key];
      writeField(document, field, value, current.fields[field.key]);
    }
    const email = data.fields.email ?? baseline.fields.email;
    const phone = data.fields.phone ?? baseline.fields.phone;
    for (const element of document.querySelectorAll('.btn-nav[data-copy], .hero-actions [data-copy], .contact-list button:first-child')) element.dataset.copy = email;
    document.querySelector('.hero-actions [data-copy]').textContent = email;
    document.querySelector('.contact-list button:nth-child(2)').dataset.copy = phone;
    const github = safeUrl(data.fields.github ?? baseline.fields.github);
    const navGithub = document.querySelector('.nav-right .nav-text-link');
    if (github) navGithub.href = github;
    else navGithub.removeAttribute('href');
    const githubLabel = document.querySelector('.contact-list a:nth-child(4) span');
    if (github !== safeUrl(baseline.fields.github)) githubLabel.textContent = 'GitHub';
    else githubLabel.textContent = 'GitHub (@Pranay890)';

    if (Array.isArray(data.lists.projects) && JSON.stringify(current.lists.projects) !== JSON.stringify(data.lists.projects)) {
      window.portfolioProjects.write(data.lists.projects);
    }
    for (const list of collections) {
      if (Array.isArray(data.lists[list.key]) && JSON.stringify(current.lists[list.key]) !== JSON.stringify(data.lists[list.key])) {
        renderList(list, data.lists[list.key]);
      }
    }
    current = structuredClone(data);
  }

  window.portfolioPage = { baseline: () => ({ version: 1, ...structuredClone(baseline) }), apply };
  if (!(window.parent !== window && new URLSearchParams(location.search).has('studio-preview'))) {
    read('published').then(document => apply(document?.studio)).catch(() => {
      // The bundled portfolio is the fallback if the content service is unavailable.
    });
  }
})();
