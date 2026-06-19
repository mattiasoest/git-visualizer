package app.gitvisualizer.events;

import java.io.IOException;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.service.EventStreamService;

@RestController
@RequestMapping("/api")
public class EventsController {

	private final EventStreamService streamService;

	public EventsController(EventStreamService streamService) {
		this.streamService = streamService;
	}

	@GetMapping("/stream/events")
	public SseEmitter streamEvents() throws IOException {
		return streamService.subscribeToStream();
	}
}
