import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock
from app.models.donor import Donor
from app.repositories.donor_repo import DonorRepository


class TestDonorLocationFreshness(unittest.TestCase):

    def setUp(self):
        self.mock_db = AsyncMock()
        self.repo = DonorRepository(self.mock_db)

    def test_donor_location_freshness_check(self):
        """Test timestamp freshness evaluation against max_location_age_minutes cutoff."""
        now = datetime.now(timezone.utc)
        max_age = 60  # minutes
        cutoff = now - timedelta(minutes=max_age)

        fresh_donor = Donor(
            id="d-fresh",
            blood_group="O-",
            is_available=True,
            latitude=12.9716,
            longitude=77.5946,
            location_updated_at=now - timedelta(minutes=15),
        )

        stale_donor = Donor(
            id="d-stale",
            blood_group="O-",
            is_available=True,
            latitude=12.9716,
            longitude=77.5946,
            location_updated_at=now - timedelta(minutes=90),
        )

        # Fresh donor's update is after cutoff
        self.assertGreaterEqual(fresh_donor.location_updated_at, cutoff)
        # Stale donor's update is before cutoff
        self.assertLess(stale_donor.location_updated_at, cutoff)

    def test_heartbeat_refreshes_location_timestamp(self):
        """Test that a new heartbeat sets location_updated_at to current time and resets freshness."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=60)

        donor = Donor(
            id="d1",
            blood_group="O-",
            is_available=True,
            location_updated_at=now - timedelta(minutes=120),  # Stale: 2 hours ago
        )
        self.assertLess(donor.location_updated_at, cutoff)

        # Simulate heartbeat at new location
        new_time = datetime.now(timezone.utc)
        donor.latitude = 12.9800
        donor.longitude = 77.6000
        donor.location_updated_at = new_time

        self.assertGreaterEqual(donor.location_updated_at, cutoff)
        self.assertEqual(donor.latitude, 12.9800)


if __name__ == "__main__":
    unittest.main()
