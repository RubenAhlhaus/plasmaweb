import type { Locator, Page } from 'playwright/test';
import type { SidebarTitle } from './Sidebar';

export class Screens {
  constructor(private readonly page: Page) {}

  homeMarker(): Locator {
    // DirectionalControl exists only on HomeScreen and uses stable aria-labels.
    return this.page.getByRole('button', { name: 'X-Achse rechts' });
  }

  macrosMarker(): Locator {
    return this.page.getByRole('heading', { name: 'Programm-Warteschlange' });
  }

  programMarker(): Locator {
    return this.page.getByRole('button', { name: 'Datei laden' });
  }

  toolsMarker(): Locator {
    return this.page.getByRole('heading', { name: 'Werkzeuge' });
  }

  probingMarker(): Locator {
    return this.page.locator('[data-e2e="screen-placeholder"]');
  }

  settingsMarker(): Locator {
    return this.page.getByRole('heading', { name: 'Einstellungen' });
  }

  markerFor(title: SidebarTitle): Locator {
    switch (title) {
      case 'Home':
        return this.homeMarker();
      case 'Macros':
        return this.macrosMarker();
      case 'Program':
        return this.programMarker();
      case 'Tools':
        return this.toolsMarker();
      case 'Probing':
        return this.probingMarker();
      case 'Settings':
        return this.settingsMarker();
      default: {
        // Exhaustiveness guard.
        const _exhaustive: never = title;
        return _exhaustive;
      }
    }
  }
}

