(function () {
  'use strict';
  const service = 'https://ruxvzfgfxfflaynxplut.supabase.co';
  const publicKey = 'sb_publishable_aIQSWAxbII8BpkCPvsm5kg_QN_7nSVB';
  const mainRow = 'id=eq.main';

  function safeUrl(value, local = false) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, window.location.origin);
      if (local && url.origin === window.location.origin && /^(\/[^/]|\.\/)/.test(value)) {
        return url.pathname + url.search + url.hash;
      }
      return /^https:\/\//i.test(value) && url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }

  async function request(path, { token, body, headers, ...options } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('apikey', publicKey);
    if (token) requestHeaders.set('Authorization', 'Bearer ' + token);
    if (body !== undefined && !(body instanceof Blob)) {
      requestHeaders.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }
    const response = await fetch(service + path, { ...options, headers: requestHeaders, body, cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.message || data?.msg || data?.error_description || 'Unable to reach the portfolio service.');
    }
    return data;
  }

  async function read(kind, token) {
    const [table, column] = kind === 'draft' ? ['portfolio_drafts', 'content'] : ['portfolio_content', 'published'];
    const rows = await request('/rest/v1/' + table + '?' + mainRow + '&select=' + column, { token, signal: AbortSignal.timeout(7000) });
    return rows?.[0]?.[column] || null;
  }

  async function save(kind, previous, studio, token) {
    const [table, column] = kind === 'draft' ? ['portfolio_drafts', 'content'] : ['portfolio_content', 'published'];
    const revision = previous?.studio?.revision;
    const query = mainRow + '&' + column + '->studio->>revision=' + (revision ? 'eq.' + encodeURIComponent(revision) : 'is.null');
    const document = { ...previous, studio };
    const rows = await request('/rest/v1/' + table + '?' + query, {
      token, method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { [column]: document }
    });
    if (rows?.length !== 1) throw new Error('Another session updated this content. Reload the studio before saving again.');
    return document;
  }

  async function upload(file, token) {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const extension = extensions[file.type];
    if (!extension || !file.size || file.size > 5 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG, or WebP image up to 5 MB.');
    }
    const path = '/portfolio-media/' + crypto.randomUUID() + '.' + extension;
    await request('/storage/v1/object' + path, { token, method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    return service + '/storage/v1/object/public' + path;
  }

  const field = (key, label, selector, type = 'text', attr = '') => ({ key, label, selector, type, attr });
  const groups = [
    { id: 'overview', title: 'Landing page', fields: [
      field('siteTitle', 'Browser tab title', 'title'),
      field('brand', 'Navigation name', '.brand span:last-child'),
      field('availability', 'Availability and location', '.hero-meta span:last-child'),
      field('greeting', 'Greeting', '.hero-greeting'),
      field('headline', 'Headline', '.hero-title', 'headline'),
      field('intro', 'Introduction', '.hero-sub', 'long'),
      field('heroImage', 'Hero image', '#heroImg', 'image', 'src'),
      field('heroAlt', 'Hero image description', '#heroImg', 'text', 'alt')
    ] },
    { id: 'projects', title: 'Projects', fields: [
      field('projectsTitle', 'Section heading', '#projects > .container > .sec-head .sec-title'),
      field('aiTitle', 'AI projects heading', '#aiBuildsTitle'),
      field('aiIntro', 'AI projects introduction', '.ai-intro', 'long')
    ] },
    { id: 'experience', title: 'Experience', fields: [
      field('experienceTitle', 'Section heading', '#experience .sec-title')
    ] },
    { id: 'education', title: 'Education and certifications', fields: [
      field('educationTitle', 'Section heading', '#education .sec-title'),
      field('educationBadge', 'Education badge', '#education .panel-header .mono'),
      field('certificationBadge', 'Certifications badge', '.ibm-pill')
    ] },
    { id: 'skills', title: 'Skills', fields: [
      field('skillsTitle', 'Section heading', '#skills .sec-title')
    ] },
    { id: 'contact', title: 'Contact', fields: [
      field('contactTitle', 'Section heading', '.contact-title'),
      field('contactIntro', 'Contact introduction', '.contact-sub', 'long'),
      field('email', 'Email address', '.contact-list button:nth-child(1) span:first-child', 'email'),
      field('phone', 'Phone number', '.contact-list button:nth-child(2) span:first-child', 'tel'),
      field('linkedin', 'LinkedIn URL', '.contact-list a:nth-child(3)', 'link', 'href'),
      field('github', 'GitHub URL', '.contact-list a:nth-child(4)', 'link', 'href'),
      field('footer', 'Footer text', '.footer-bar span')
    ] }
  ];
  const lists = [
    { key: 'projects', group: 'projects', label: 'Selected work', singular: 'project', fields: [
      field('title', 'Project title'), field('domain', 'Area or specialty'), field('desc', 'Description', '', 'long'),
      field('group', 'Filter category', '', 'category'), field('github', 'Repository URL', '', 'link'),
      field('stack', 'Technologies', '', 'lines'), field('metrics', 'Metrics (value | label)', '', 'metrics'),
      field('problem', 'Case study problem', '', 'long'), field('architecture', 'Case study approach', '', 'long'),
      field('impact', 'Case study impact', '', 'long')
    ] },
    { key: 'aiBuilds', group: 'projects', root: '.ai-builds-grid', item: '.ai-build', label: 'Built with AI', singular: 'AI project', fields: [
      field('title', 'Project title', '.proj-h3'), field('domain', 'Area or specialty', '.proj-domain'),
      field('subtitle', 'Subtitle', '.ai-build-subtitle'), field('description', 'Description', '.proj-desc', 'long'),
      field('stack', 'Technologies', '.tag-list', 'lines'), field('note', 'Project note', '.ai-build-note', 'long'),
      field('image', 'Project image', 'img', 'image', 'src'), field('alt', 'Image description', 'img', 'text', 'alt'),
      field('github', 'Repository URL', '.ai-build-actions a[href*="github.com"]', 'link', 'href'),
      field('live', 'Live app URL', '.ai-build-actions .btn-primary', 'link', 'href')
    ] },
    { key: 'experience', group: 'experience', root: '#experience > .container', item: '.exp-box', label: 'Roles', singular: 'role', fields: [
      field('title', 'Role', '.exp-role'), field('organization', 'Organization', '.exp-org'),
      field('dates', 'Dates and location', '.exp-meta-col .mono'), field('metrics', 'Metrics (value | label)', '.sig-metrics', 'metrics'),
      field('bullets', 'Achievements', '.exp-bullets', 'bullets')
    ] },
    { key: 'education', group: 'education', root: '.edu-rows', item: ':scope > div', label: 'Education', singular: 'education entry', fields: [
      field('title', 'Qualification', '.edu-deg'), field('dates', 'Dates', '.edu-row-top .mono'),
      field('school', 'School and location', '.edu-school'), field('details', 'Coursework or details', '.edu-course', 'long')
    ] },
    { key: 'certifications', group: 'education', root: '.cert-rows', item: '.cert-row', label: 'Certifications', singular: 'certificate', fields: [
      field('title', 'Certificate name', '.cert-name'), field('issuer', 'Issuer', '.mono')
    ] },
    { key: 'skills', group: 'skills', root: '.skills-grid', item: '.skill-panel', label: 'Skill groups', singular: 'skill group', fields: [
      field('title', 'Group name', '.skill-h3'), field('tags', 'Skills', '.skill-tags', 'lines')
    ] }
  ];

  window.portfolioContent = { mainRow, request, read, save, upload, safeUrl, groups, lists };
})();
