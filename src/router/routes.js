const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', name: 'dashboard', component: () => import('pages/DashboardPage.vue') },
      { path: 'sites', name: 'sites', component: () => import('pages/SitesPage.vue') },
      { path: 'php', name: 'php', component: () => import('pages/PhpPage.vue') },
      { path: 'services', name: 'services', component: () => import('pages/ServicesPage.vue') },
      { path: 'databases', name: 'databases', component: () => import('pages/DatabasesPage.vue') },
      { path: 'mail', name: 'mail', component: () => import('pages/MailPage.vue') },
      { path: 'dumps', name: 'dumps', component: () => import('pages/DumpsPage.vue') },
      { path: 'logs', name: 'logs', component: () => import('pages/LogsPage.vue') },
      { path: 'console', name: 'console', component: () => import('pages/ConsolePage.vue') },
      { path: 'settings', name: 'settings', component: () => import('pages/SettingsPage.vue') }
    ]
  },
  { path: '/:catchAll(.*)*', component: () => import('pages/ErrorNotFound.vue') }
]

export default routes
