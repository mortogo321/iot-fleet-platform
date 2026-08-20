import { classNames } from '../lib/format';
import type { ViewName } from '../types';

const TABS: Array<{ id: ViewName; label: string }> = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'device', label: 'Device' },
  { id: 'alerts', label: 'Alerts & Rules' },
];

export function Tabs({
  active,
  onChange,
}: {
  active: ViewName;
  onChange: (view: ViewName) => void;
}) {
  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={classNames('tab', active === tab.id && 'tab-active')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
