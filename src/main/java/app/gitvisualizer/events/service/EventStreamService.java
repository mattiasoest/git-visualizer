package app.gitvisualizer.events.service;

import java.io.IOException;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import app.gitvisualizer.events.dto.EventView;
import app.gitvisualizer.events.support.EventMapper;
import app.gitvisualizer.events.support.EventRingBuffer;

@Service
public class EventStreamService {

	private final EventRingBuffer ringBuffer;
	private final EventMapper eventMapper;
	private final EventBroadcaster broadcaster;
	private final EventReleaseScheduler releaseScheduler;

	public EventStreamService(
			EventRingBuffer ringBuffer,
			EventMapper eventMapper,
			EventBroadcaster broadcaster,
			EventReleaseScheduler releaseScheduler) {
		this.ringBuffer = ringBuffer;
		this.eventMapper = eventMapper;
		this.broadcaster = broadcaster;
		this.releaseScheduler = releaseScheduler;
	}

	public SseEmitter subscribeToStream(int replay) throws IOException {
		int cappedReplay = Math.min(Math.max(replay, 0), 1000);
		SseEmitter emitter = broadcaster.subscribe();

		List<EventView> replayEvents = ringBuffer.snapshot(cappedReplay).stream()
				.map(eventMapper::toView)
				.toList();
		int windowSeconds = releaseScheduler.remainingWindowSeconds();
		releaseScheduler.replayToEmitter(emitter, replayEvents, windowSeconds);

		return emitter;
	}
}
