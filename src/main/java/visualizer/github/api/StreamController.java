package visualizer.github.api;

import java.io.IOException;
import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import visualizer.github.github.EventRingBuffer;
import visualizer.github.stream.EventBroadcaster;

@RestController
@RequestMapping("/api/stream")
public class StreamController {

	private final EventBroadcaster broadcaster;
	private final EventRingBuffer ringBuffer;
	private final EventMapper eventMapper;

	public StreamController(EventBroadcaster broadcaster, EventRingBuffer ringBuffer, EventMapper eventMapper) {
		this.broadcaster = broadcaster;
		this.ringBuffer = ringBuffer;
		this.eventMapper = eventMapper;
	}

	@GetMapping("/events")
	public SseEmitter streamEvents(@RequestParam(defaultValue = "50") int replay) throws IOException {
		int cappedReplay = Math.min(Math.max(replay, 0), 100);
		SseEmitter emitter = broadcaster.subscribe();

		List<EventView> replayEvents = ringBuffer.snapshot(cappedReplay).stream()
				.map(eventMapper::toView)
				.toList();
		broadcaster.sendReplay(emitter, replayEvents);

		return emitter;
	}
}
