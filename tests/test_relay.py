import sys, time, unittest
sys.path.insert(0, "ship_radar")
import relay

HOME = (-33.92, 18.42)

def pos(mmsi, lat, lon, kind="PositionReport", **body):
    return {"MessageType": kind, "MetaData": {"MMSI": mmsi, "ShipName": "TEST SHIP  ", "latitude": lat, "longitude": lon},
            "Message": {kind: {"UserID": mmsi, "Latitude": lat, "Longitude": lon, **body}}}

def static(mmsi, t, a, b, c, d, dest):
    return {"MessageType": "ShipStaticData", "MetaData": {"MMSI": mmsi, "ShipName": "TEST SHIP"},
            "Message": {"ShipStaticData": {"Type": t, "Destination": dest + "@@@", "Dimension": {"A": a, "B": b, "C": c, "D": d}}}}

class FleetTest(unittest.TestCase):
    def setUp(self):
        self.f = relay.Fleet(*HOME, 30, 600)

    def test_merge_position_and_static(self):
        self.f.update(pos(636012345, -33.80, 18.45, Sog=12.3, Cog=215.0, TrueHeading=511, NavigationalStatus=0))
        self.f.update(static(636012345, 71, 250, 50, 20, 20, "DURBAN"))
        ships, total = self.f.snapshot()
        self.assertEqual(total, 1)
        s = ships[0]
        self.assertEqual((s["cat"], s["len"], s["beam"], s["dest"], s["flag"]), ("cargo", 300, 40, "DURBAN", "LR"))
        self.assertIsNone(s["hdg"])           # 511 = not available
        self.assertEqual(s["sog"], 12.3)
        self.assertEqual(s["name"], "TEST SHIP")

    def test_unavailable_values_and_status(self):
        self.f.update(pos(311000111, -33.90, 18.40, Sog=102.3, Cog=360.0, TrueHeading=90, NavigationalStatus=15))
        s = self.f.snapshot()[0][0]
        self.assertIsNone(s["sog"]); self.assertIsNone(s["cog"]); self.assertIsNone(s["status"])

    def test_class_b_and_static_report(self):
        self.f.update(pos(601123456, -33.95, 18.43, kind="StandardClassBPositionReport", Sog=5.1, Cog=90.0, TrueHeading=88))
        self.f.update({"MessageType": "StaticDataReport", "MetaData": {"MMSI": 601123456},
                       "Message": {"StaticDataReport": {"ReportA": {"Name": "SEA BREEZE@@"}, "ReportB": {"ShipType": 36, "Dimension": {"A": 8, "B": 4, "C": 2, "D": 2}}}}})
        s = self.f.snapshot()[0][0]
        self.assertEqual((s["name"], s["cat"], s["len"], s["flag"]), ("SEA BREEZE", "sailing", 12, "ZA"))

    def test_range_expiry_and_sorting(self):
        now = time.time()
        self.f.update(pos(1, -33.90, 18.40), now)
        self.f.update(pos(2, -33.80, 18.40), now)
        self.f.update(pos(3, -30.00, 18.40), now)        # far outside 30 nm
        ships, total = self.f.snapshot(now)
        self.assertEqual([s["mmsi"] for s in ships], [1, 2]); self.assertEqual(total, 2)
        self.assertEqual(self.f.snapshot(now + 601)[1], 0)  # expired

    def test_static_only_ship_not_listed(self):
        self.f.update(static(2, 70, 100, 20, 10, 10, "X"))
        self.assertEqual(self.f.snapshot()[1], 0)

    def test_geometry(self):
        d, b = relay.distance_bearing(0, 0, 1, 0)
        self.assertAlmostEqual(d, 60.0, delta=0.3); self.assertAlmostEqual(b, 0, delta=0.1)
        d, b = relay.distance_bearing(0, 0, 0, 1)
        self.assertAlmostEqual(b, 90, delta=0.1)
        box = relay.bounding_box(*HOME, 30)
        self.assertTrue(box[0][0] < HOME[0] < box[1][0] and box[0][1] < HOME[1] < box[1][1])

    def test_payload_size(self):
        now = time.time()
        for i in range(80):
            self.f.update(pos(636000000 + i, -33.9 + i * 0.002, 18.4 + i * 0.002, Sog=10.5, Cog=123.0, TrueHeading=120, NavigationalStatus=0), now)
            self.f.update(static(636000000 + i, 70, 250, 50, 20, 20, "PORT ELIZABETH"), now)
        import json
        p = relay.build_payload(self.f, {"connected": True, "error": None}, {})
        self.assertEqual(len(p["attributes"]["ships"]), relay.MAX_SHIPS)
        self.assertLess(len(json.dumps(p["attributes"])), 16384)

if __name__ == "__main__":
    unittest.main()
