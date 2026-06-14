package app.gitvisualizer.events;

import java.io.IOException;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.dto.EventsSnapshotResponse;
import app.gitvisualizer.events.service.EventService;

@RestController
@RequestMapping("/api")
public class EventsController {

	private final EventService eventService;

	public EventsController(EventService eventService) {
		this.eventService = eventService;
	}

	@GetMapping("/events")
	public EventsSnapshotResponse getEvents(@RequestParam(defaultValue = "50") int limit) {
		return eventService.getSnapshot(limit);
	}

	@GetMapping("/stream/events")
	public SseEmitter streamEvents(@RequestParam(defaultValue = "50") int replay) throws IOException {
		return eventService.subscribeToStream(replay);
	}
}
