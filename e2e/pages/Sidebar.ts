import type { Locator, Page } from 'playwright/test';

export type SidebarTitle = 'Home' | 'Macros' | 'Program' | 'Tools' | 'Probing' | 'Settings';

export class Sidebar {
  constructor(private readonly page: Page) {}

  buttonByTitle(title: SidebarTitle): Locator {
    // AppTooltip does not set native `title` on the button — stable test hook in RightSidebar.
    return this.page.locator(`[data-e2e="sidebar-nav-${title.toLowerCase()}"]`);
  }

  async clickByTitle(title: SidebarTitle): Promise<void> {
    await this.buttonByTitle(title).click();
  }
}

