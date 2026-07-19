import { Component, OnInit, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, SimpleChanges } from '@angular/core';
import * as L from 'leaflet';

@Component({
  selector: 'app-visitor-map',
  templateUrl: './visitor-map.component.html',
  styleUrls: ['./visitor-map.component.scss']
})
export class VisitorMapComponent implements OnInit, OnChanges {
  @Input() locations: any[] = [];
  @Input() compact: boolean = false;
  @Output() locationSelected = new EventEmitter<any>();

  @ViewChild('mapContainer', { static: false }) mapContainer: ElementRef;

  private map: L.Map;
  private markers: L.Layer[] = [];

  constructor() { }

  ngOnInit(): void {
    this.initializeMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locations'] && !changes['locations'].firstChange && this.map) {
      this.updateMarkers();
    }
  }

  private initializeMap(): void {
    setTimeout(() => {
      if (!this.mapContainer) return;

      const defaultCenter: L.LatLng = L.latLng(20, 0);
      const defaultZoom = this.compact ? 2 : 2;

      this.map = L.map(this.mapContainer.nativeElement).setView(defaultCenter, defaultZoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(this.map);

      this.updateMarkers();
    }, 0);
  }

  private updateMarkers(): void {
    if (!this.map) return;

    // Clear existing markers
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    if (!this.locations || this.locations.length === 0) return;

    // Calculate bounds to fit all markers
    const bounds = L.latLngBounds([]);
    let hasValidCoordinates = false;

    this.locations.forEach(location => {
      if (location.latitude && location.longitude) {
        hasValidCoordinates = true;
        const lat = parseFloat(location.latitude);
        const lng = parseFloat(location.longitude);

        const marker = L.circleMarker([lat, lng], {
          radius: Math.min(20, Math.max(5, Math.sqrt(location.visits || 1) * 2)),
          fillColor: '#016fff',
          color: '#016fff',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.6
        });

        marker.bindPopup(`
          <div class="popup-content">
            <strong>${location.city || 'Unknown'}</strong><br>
            ${location.country || ''}<br>
            <small>${location.visits || 0} visits</small>
          </div>
        `);

        marker.on('click', () => {
          this.locationSelected.emit(location);
        });

        this.markers.push(marker);
        marker.addTo(this.map);
        bounds.extend([lat, lng]);
      }
    });

    // Fit map to bounds if we have valid coordinates
    if (hasValidCoordinates && this.markers.length > 0) {
      try {
        this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
      } catch (e) {
        // Handle case where bounds are invalid
        this.map.setView([20, 0], 2);
      }
    }
  }
}
