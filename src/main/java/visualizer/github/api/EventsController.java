package visualizer.github.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import visualizer.github.github.EventRingBuffer;
import visualizer.github.github.GitHubEventPoller;

@RestController
@RequestMapping("/api")
public class EventsController {

	private final EventRingBuffer ringBuffer;
	private final EventMapper eventMapper;
	private final GitHubEventPoller poller;

	public EventsController(EventRingBuffer ringBuffer, EventMapper eventMapper, GitHubEventPoller poller) {
		this.ringBuffer = ringBuffer;
		this.eventMapper = eventMapper;
		this.poller = poller;
	}

	@GetMapping("/events")
	public EventsSnapshotResponse getEvents(@RequestParam(defaultValue = "50") int limit) {
		int cappedLimit = Math.min(Math.max(limit, 1), 100);
		List<EventView> events = ringBuffer.snapshot(cappedLimit).stream()
				.map(eventMapper::toView)
				.toList();

		return new EventsSnapshotResponse(events, poller.getLastPollAt());
	}

	public record EventsSnapshotResponse(
			List<EventView> events,
			java.time.Instant lastPollAt
	) {
	}
}
