import Header from "@/components/Header";
import VideoPerception from "@/components/VideoPerception";
import OccupancyGrid from "@/components/OccupancyGrid";
import TelemetryPanel from "@/components/TelemetryPanel";
import FailsafeMonitor from "@/components/FailsafeMonitor";
import SystemDiagnostics from "@/components/SystemDiagnostics";
import WaypointNavigation from "@/components/WaypointNavigation";
import UltrasonicPanel from "@/components/UltrasonicPanel";

export default function Dashboard() {
  return (
    <div className="flex flex-col min-h-screen p-4 md:p-6 gap-6">
      <Header />

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column - Video & Grid */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <section className="tactical-panel flex-1 min-h-[400px]">
            <VideoPerception />
          </section>
          
          <section className="tactical-panel h-[400px]">
            <OccupancyGrid />
          </section>
        </div>

        {/* Middle Column - Telemetry & Nav & Ultrasonics */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          <section className="tactical-panel min-h-[250px]">
            <WaypointNavigation />
          </section>
          
          <section className="tactical-panel h-[200px]">
            <UltrasonicPanel />
          </section>

          <section className="tactical-panel flex-1 min-h-[300px]">
            <TelemetryPanel />
          </section>
        </div>

        {/* Right Column - Diagnostics & Failsafe */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          <section className="tactical-panel flex-1 min-h-[300px]">
            <SystemDiagnostics />
          </section>
          
          <section className="tactical-panel min-h-[300px]">
            <FailsafeMonitor />
          </section>
        </div>
      </main>
    </div>
  );
}
