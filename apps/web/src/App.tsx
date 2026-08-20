import { useEffect, useState } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge';
import { Tabs } from './components/Tabs';
import { useWsStatus, wsClient } from './lib/ws';
import { ToastProvider } from './toast/ToastProvider';
import type { ViewName } from './types';
import { AlertsView } from './views/AlertsView';
import { DeviceView } from './views/DeviceView';
import { FleetView } from './views/FleetView';

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [activeTab, setActiveTab] = useState<ViewName>('fleet');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const wsStatus = useWsStatus();

  useEffect(() => {
    wsClient.start();
  }, []);

  function handleSelectDevice(deviceId: string) {
    setSelectedDeviceId(deviceId);
    setActiveTab('device');
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">IoT Fleet Console</div>
        <Tabs active={activeTab} onChange={setActiveTab} />
        <ConnectionBadge status={wsStatus} />
      </header>
      <main className="content">
        {/* All three views stay mounted so their WS subscriptions and local state
            (sparkline history, chart range, RPC log…) survive a tab switch. */}
        <div style={{ display: activeTab === 'fleet' ? 'block' : 'none' }}>
          <FleetView onSelectDevice={handleSelectDevice} />
        </div>
        <div style={{ display: activeTab === 'device' ? 'block' : 'none' }}>
          <DeviceView deviceId={selectedDeviceId} />
        </div>
        <div style={{ display: activeTab === 'alerts' ? 'block' : 'none' }}>
          <AlertsView />
        </div>
      </main>
    </div>
  );
}
