package app.gitvisualizer.events.dto;

import java.time.Instant;
import java.util.List;

public record EventsSnapshotResponse(
		List<EventView> events,
		Instant lastPollAt
) {
}
